
# Double-Entry Database

This doc describes a design for a data storage layer for
double-entry accounting.  The primary design goals are:

* supports the double-entry accounting model: every transaction
  spans two or more accounts, and all amounts should sum to zero.

* very fast for both reads and writes.

* propagates changes instantly, so all information we show
  the user is always up-to-date.  We never have to take time
  to "generate a report" or make the user wait for a "processing"
  step.

The last goal is more difficult than it sounds.  An accounting
ledger, by its nature, forms a highly connected data dependency
graph.  If you change the amount of an early transaction, it
affects every subsequent balance in that account.  When you have
a nested account hierarchy, any change to a leaf transaction
affects all parent accounts up to the root.  Propagating changes
efficiently is not trivial.  But it is important for providing a
good user experience.

## Client-side vs. server-side

This design is not specific to any UI, but it is designed to be
a client-side storage layer.

You could easily store this data in a server also; nothing
would preclude this.  But we don't use the server for change
propagation.  Say you had requested 100 transactions from
the server, and then you updated the first transaction.
That update might invalidate the "current balance" of all
subsequent transactions that you previously requested.  But
it wouldn't make sense for the server to proactively send
you updates for all 99 other transactions -- you might not
care about them.

That is why this design focuses on the client-side case.  We
are focused on the case where the client keeps a copy of the
entire database in a client-side store like [indexed
DB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API),
but also keeps objects that are currently being shown to the
user in memory.  Then it is the database's job to make sure
that all of the in-memory objects are always up-to-date, and
that all writes are immediately stored to the client-side
database.

It is expected that the client-side database will also sync
itself to a server-side database.  There are several
possible ways to do this (and we don't go into it in this
document), but the best approach is probably to keep a
commit log of changes locally that are pushed to the server
regularly.  For syncing in the other direction, we can pull
new changes from the server-side commit log and apply them
locally.

## Basic Data Model and API

The double-entry database is, at its core, a series of
date-ordered transactions.  Each transaction has a guid and
some associated data.

```
   transaction: {guid=<...> date="2015-06-21 00:35" <txn data>}
   transaction: {guid=<...> date="2015-06-22 23:54" <txn data>}
   (etc...)
```

Each transaction has two or more entries.  Each entry has an
account and an amount.  Since this is double-entry
accounting, all the entries for a transaction must sum to
zero:

```
   transaction: {<...> description="Paycheck" entries=[
      {account_guid=<job income account> amount="-$1000"},
      {account_guid=<checking account> amount="$1000"}
    ]
   }
```

The database also stores a hierarchical list of accounts.
Each account has a guid, a name, a type
(asset/liability/income/expense), and a parent guid.  These
are all basic ideas with lots of precedent in apps like
GnuCash.

Accounts that don't have a explicit parent guid are
automatically have their parent assigned to one of the two
account roots:

1. the real root, for all asset/liability accounts.
2. the nominal root, for all income/expense accounts.

## Write API

Transaction and account data is easy to manipulate through
the `DB` API:

```javascript
  // The schema for accountData and txnData live in model.proto.
  account = db.createAccount(accountData)
  txn = db.createTransaction(txnData)

  account.update(newAccountData)
  account.delete()

  txn.update(newTxnData)
  txn.delete()
```

The database always performs validity checks and will always
reject writes that violate these checks (for example,
deleting an account when transactions still refer to it).

## Read API

Transaction and balance data are easy to read with the
`Reader` API.  There are two main kinds of readers you
can obtain:

1. a **balance reader**, which yields the balance of an
   account at specified points in time (eg. the balance
   of my checking account on the 1st of each month over
   a year).  This is useful for drawing graphs or
   displaying reports.

2. an **entry reader**, which yields a series of transaction
   entries that pertain to the account (eg. all transactions
   on my credit card this month).

When you obtain a reader, you can iterate over its contents
as many times as you want.  The database ensures that the
data from the reader is always perfectly up-to-date (this is
its primary feature).

```javascript
  reader = account.newBalanceReader({
    "count": 12,
    "end": new Date("2015-12-01"),
    "period": "MONTH"
   });

  // Draw a graph of this account's balance over time.
  for (balance of reader.iterator()) {
    graph.addPoint(balance.amount);
  }
```

The database will ensure that the reader is up-to-date.
But you might want to take some kind of action when its
content changes, like triggering a redraw of the UI.
The database lets you register a callback that will be
called whenever the reader's content changes.

```javascript
  // Get a callback whenever any of the reader's balances change.
  reader.subscribe(this, function() { /* update graph */ });
```

`Account` and `Transaction` objects are also `Observable`,
so any on-screen displays of account information (like
account name) can also be kept up-to-date.


## Data Storage and Update Propagation

As we've mentioned already, propagation of updates is
potentially expensive because of how long the dependency
chain of values is.  Every transaction affects the subsequent
balances for that account and every parent account.  We can
visualize this as a list of transactions in an account and
its sub-accounts (since transactions affect parent accounts
even though they are not technically "in" the parent
account, we put them in parentheses.

```
time   ACCOUNT            SUBACCOUNT         SUBSUBACCOUNT
 |     txn / balance
 |     (txn) / balance    (txn) / balance    txn / balance
 |     (txn) / balance    txn / balance
 |     (txn) / balance    (txn) / balance    txn / balance
 |
 V
```

In the diagram above, any transaction change affects all
balances below and to the left of the transaction being
changed.  And this is repeated for every account entry in
the transaction.

We need both reading (of balance data) and writing (of
transaction data) to be nearly instantaneous.  We also need
updates of any open `Reader` objects to be instantaneous.
Accomplishing all of these goals takes some work.

It is important that neither reading nor writing take `O(n)`
database operations, where `n` is the number of
transactions. So we can't, for example, store a pre-computed
"current balance" in the database with every transaction, because
then `O(n)` transactions would need to be updated in the DB
whenever a prior transaction changed.

One thing we could do is store precomputed sums for a
*window of time*. For example, for each account, store
per-month sums of all transactions for that month. Then to
compute the current balance, read all the windowed sums and
add them up.

This is a good start, but we can do better.  This solution
no longer requires `O(n)` operations where `n = number of
transactions`, but it does still require `O(n)` operations
to read the current balance, where `n = time` (ie. number of
months).

We can reduce this to `O(n lg n)` operations to read the
balance at any point in time.  The key idea is to compute
sums at multiple levels. For example, we can store
pre-computed sums for year, month, week, etc.  Then when we
want to read a balance for any point in time, we use the
coarsest possible sum at each level.

For example, here is a visual representation of some
computed sums:

```
  A = all-time rollup
  Y = yearly rollup
  M = monthly rollup

  ^ ^ M
  | | M
  | | M
  | | M
  | | M
  | Y M
  | | M
  | | M
  | | M
  | | M
  | V M
  A ^ M
  | | M
  | | M
  | | M
  | | M
  | Y M
  | | M
  | | M
  | | M
  | | M
  V V M
```

If we want the current balance for the account, then we can
of course read the all-time rollup. But what if we want a
balance for halfway through the second year?

We can compute this by adding the first year's rollup to the
second year's monthly rollups:

<pre>
  A = all-time rollup
  Y = yearly rollup
  M = monthly rollup

  ^ <i><b>^</b></i> M
  | <i><b>|</b></i> M
  | <i><b>|</b></i> M
  | <i><b>|</b></i> M
  | <i><b>|</b></i> M
  | <i><b>Y</b></i> M
  | <i><b>|</b></i> M
  | <i><b>|</b></i> M
  | <i><b>|</b></i> M
  | <i><b>|</b></i> M
  | <i><b>V</b></i> M
  A ^ <i><b>M</b></i>
  | | <i><b>M</b></i>
  | | <i><b>M</b></i>
  | | M
  | | M
  | Y M
  | | M
  | | M
  | | M
  | | M
  V V M</pre>

If we use this strategy, and store all of the precomputed
sums in the database, then:

* Every transaction **update** will need to update `O(m)`
  sums, where `m = account depth`, since we have to update
  sums at every level. This is ok though, since we expect `m`
  to be much, much smaller than `n` (the number of
  transactions per account).

* Every balance **read** will need to read `O(n lg n)` sums. [1]

In both cases, those are *also* the bounds on how many sums
need to be loaded into memory to perform the read or write!

[1]: note that this asymptotic bound isn't really true if we
have statically-configured sum periods (like: year, month,
day).  With only those granularities, we could easily make
the cost to read `O(n)` by creating `n` transactions in a
single day, or `n` transactions spread over `n` years.  Both
of these cases would force us to read `O(n)` database items
instead of the `O(n lg n)` we are looking for.  To truly
enforce `O(n lg n)` we'd need adaptive time windows for the
sums that react to the actual distribution of transactions
over time.  But this would be significantly more
complicated, so we won't go there until/unless it is
required.

## Database Schema

With the general approach given above, here is the specific
database schema. This is designed with IndexedDB in mind,
but could be implemented on other database types also, like
SQL databases.

### ObjectStore: Accounts

* **primary key:** guid

Each object follows the `Account` schema in `model.proto`.

It is assumed that the list of accounts can be reasonably
loaded into memory, so no thought is given for trying to
avoid that.  The implementation loads all accounts when
a DB object is created.

### ObjectStore: Transactions

* **primary key:** timestamp
* **unique index**: guid

Each object follows the `Transaction` schema in
`model.proto`.

Transactions are ordered by timestamp, so it is convenient
to load only a specific time range of transactions. Often
people want to look at the most recent transactions, or
transactions from a specific time window, so this should be
efficient. The unique index on `guid`  supports efficient
lookup by guid and prevents duplicates.

One possible scaling challenge here is that you can't load
transactions for only a leaf account (or intermediate
account).  So to show transactions for an extremely sparse
leaf account, you have to load far more transactions than
will be displayed.  For leaf accounts this could be solved
with a (`account`, `timestamp`) index.  This could be a
useful addition, though it wouldn't solve the problem for
intermediate accounts.

### ObjectStore: Sums

* **primary key:** `sum_key` (see below)

Each object is simply a balance (a bunch of amounts in one
or more currencies) representing the sum of all entry
amounts for this time window.

The `sum_key` is a combination of (`account_guid`,
`granularity`, `timestamp`), in that order. For example,
(CheckingAccountGuid, MONTHLY, 2015-03) would represent the
monthly rollup for the checking account in March 2015. This
ordering makes it efficient to read a range of sums for a
given account and granularity, which is an operation
required by several common operations.

For now we assume that all sums will be loaded at all times.
The DB object will load them when it is created.  This
simplifies the implementation a lot, but if this becomes
an issue at some point this could be changed to use lazy
loading.

## Update Algorithm

Whenever a `Transaction` is created or loaded, it obtains
(loading if necessary) any `Sum` objects pertaining to that
`Transaction`'s time window, for every account the
`Transaction` has entries for.  Then whenever the
`Transaction` is updated, it updates those Sums accordingly
with the delta.  The `Sum` object tracks the uncommitted
delta and commits it when requested (which should be in the
same database transaction as the `Transaction` updates).

Any updates to `Sum` or `Transaction` objects notify any
open `Reader` objects that are affected.  When the `Reader`
is notified, it recomputes all of the sums within that
`Reader`.
