# Double-Entry Database

The double-entry database is a series of date-ordered
transactions:

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

The database also stores the accounts.  Accounts live in a
tree structure.  Each account has a guid, a name, a type
(asset/liability/income/expense), and a parent guid.

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
  account = DB.createAccount(accountData)
  txn = DB.createTransaction(txnData)

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
`Reader` API.

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

A primary design goal is that whenever the database is
updated, all affected objects are updated immediately.  This
means that any on-screen graphs, reports, etc are always
100% up-to-date. This is achieved through the `Observable`
interface:

```javascript
  // Get a callback whenever any of the reader's balances change.
  reader.subscribe(this, function() { /* update graph */ });
```

`Account` and `Transaction` objects are also `Observable`,
so any on-screen displays of account information (like
account name) can also be kept up-to-date.


## Data Storage and Update Propagation

The database is a highly connected graph of data
dependencies.  Every transaction affects the subsequent
balances for that account and every parent account.

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
balance in the database with every transaction, because then
`O(n)` transactions would need to be updated in the DB
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

  ^ <b>^</b> M
  | <b>|</b> M
  | <b>|</b> M
  | <b>|</b> M
  | <b>|</b> M
  | <b>Y</b> M
  | <b>|</b> M
  | <b>|</b> M
  | <b>|</b> M
  | <b>|</b> M
  | <b>V</b> M
  A ^ <b>M</b>
  | | <b>M</b>
  | | <b>M</b>
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
of these cases would require reading `O(n)` database items
instead of the `O(n lg n) we are looking for.  To truly
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
avoid that.

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

### ObjectStore: Sums

* **primary key:** sum_key (see below)

Each object is simply a number representing the sum of all
entry amounts for this time region.

The `sum_key` is a combination of (account_guid,
granularity, timestamp), in that order. For example,
(CheckingAccountGuid, MONTHLY, 2015-03) would represent the
monthly rollup for the checking account in March 2015. This
ordering makes it efficient to read a range of sums for a
given account and granularity, which is an operation
required by several common operations.
