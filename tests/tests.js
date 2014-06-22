// Makes the database forget that one has been previously constructed, to work
// around the code that enforces singleton.  This is necessary for tests where
// we want to verify that the DB was persisted correctly.
function forget() { dblbook.DB.singleton = undefined; }

// Add account defaults.
var act = function(data) {
  if (!data.type) {
    data.type = "ASSET";
  }
  if (!data.commodity_guid) {
    data.commodity_guid = "USD";
  }
  return data;
}


function runTestWithDb(func) {
  stop();
  dblbook.DB.open(function(db) {
    ok(db instanceof dblbook.DB, "created object is DB");
    func(db);
    db.close();
    start();
  });
}

function getValueFromIterator(iter) {
  var pair = iter.next();
  ok(!pair.done);
  var ret = pair.value;
  ok(iter.next().done);
  return ret;
}

function dbtest(name, func) {
  test(name, function() {
    stop();

    // First delete the entire indexeddb.
    dblbook.DB.delete(function() {
      // Next open a fresh DB from scratch.
      forget();
      runTestWithDb(func);
      start();
    });
  });
}

dbtest("transaction validity", function(db) {
  ok(!dblbook.Transaction.isValid({}), "invalid txn 1");

  var account1 = db.createAccount(act({"name":"Test2"}));
  var account2 = db.createAccount(act({"name":"Test"}));
  ok(account1);
  ok(account2);

  var guid1 = account1.data.guid;
  var guid2 = account2.data.guid;

  ok(db.transactionIsValid({
    "timestamp": 12345,
    "description": "Foo Description",
    "entry": [
      {"account_guid": guid1, "amount": "1"},
      {"account_guid": guid2, "amount": "-1"},
    ]
  }), "valid txn 1");

  ok(!db.transactionIsValid({
    "timestamp": 12345,
    "description": "Foo Description",
    "entry": [
      {"account_guid": guid1, "amount": "1"},
      {"account_guid": guid2, "amount": "1"},
    ]
  }), "nonbalancing txn invalid");
});

test("account validity", function() {
  ok(!dblbook.Account.isValid({}), "invalid account 1");
  ok(dblbook.Account.isValid({
    "name":"Test", "type": "ASSET", "commodity_guid": "USD"
  }), "valid account 1");
});

test("decimal", function() {
  var isTrulyZero = function(zero) {
    ok(zero.isZero(), "zero value isZero()");
    ok(zero.toString() == "0", "zero value has 0 representation");
  }

  var zero = new dblbook.Decimal();
  ok(zero, "no-arg constructor");
  isTrulyZero(zero);
  zero.add(zero);
  isTrulyZero(zero);
  zero.add(new dblbook.Decimal())
  isTrulyZero(zero);

  var val = new dblbook.Decimal("1.1");
  equal(val.value, 11);
  equal(val.precision, 1);
  ok(!val.isZero());

  var other = new dblbook.Decimal("200.02");
  equal(other.value, 20002);
  equal(other.precision, 2);
  ok(!other.isZero());

  val.add(other);
  equal(val.value, 20112);
  equal(val.precision, 2);
  ok(!val.isZero());

  var neg = new dblbook.Decimal("-76000.007");
  equal(neg.value, -76000007);
  equal(neg.precision, 3);
  equal("-76,000.007", neg.toString());
  ok(!neg.isZero());

  var sum2 = zero.dup();
  sum2.add(neg);
  equal(sum2.value, -76000007);
  equal(sum2.precision, 3);
  equal("-76,000.007", sum2.toString());
  ok(!sum2.isZero());
});

test("balance", function() {
  var empty = new dblbook.Balance();
  ok(empty.isEmpty());
  equal(empty.toString(), "");

  var emptyWithCurrency = new dblbook.Balance("USD");
  ok(emptyWithCurrency.isEmpty());
  equal(emptyWithCurrency.toString(), "$0.00");

  var bal = new dblbook.Balance();
  bal.add(new dblbook.Balance());
  ok(bal.isEmpty());

  bal.add(emptyWithCurrency);
  ok(bal.isEmpty());

  bal.add(new dblbook.Balance("USD", "5.23"));
  equal(bal.toString(), "$5.23");
});

dbtest("empty DB", function(db) {
  ok(db.getRealRoot().children.size == 0, "empty db has no accounts");
  ok(db.getNominalRoot().children.size == 0, "empty db has no accounts");
});

dbtest("multiple DBs not allowed", function() {
  dblbook.DB.open(function(db, msg) {
    ok(db == null);
    start();
  });
  stop();
});

dbtest("CRUD account", function(db) {
  throws(function() {
    db.createAccount(act({"name":"Test", "parent_guid": "not-exists" }));
  }, "can't create an account if parent doesn't exist");

  ok(db.getRealRoot().children.size == 0);
  ok(db.createAccount(act({"name":"Test"})), "create account 1");
  ok(db.getRealRoot().children.size == 1, "now there is one account");

  var account = db.getRealRoot().children.get("Test");
  ok(account.data.guid, "created account has a guid");
  ok(account.data.name == "Test", "created account has correct name");
  ok(account.db === db, "created account has correct db");
  ok(account.parent === db.getRealRoot(), "created account top as parent");
  ok(account.children.size == 0, "created account has no children");

  var account1_guid = account.data.guid;

  var sub = db.createAccount(act({"name":"Sub", "parent_guid":account1_guid}));
  ok(sub, "create account 2");

  ok(account.children.size == 1, "now Test account has sub-account");

  // Move account to the top level.
  sub.update(act({"name":"Sub"}));

  ok(db.getRealRoot().children.size == 2, "top-level now has two accounts");
  ok(account.children.size == 0, "Test no longer has sub-account");

  throws(function() {
    db.createAccount(act({"name":"Test"}))
  }, "can't create account with duplicate name");

  ok(db.createAccount(act({ "guid": "EXPLICIT GUID", "name": "YO"})),
     "can create an account with an explicit GUID set.");
});

dbtest("Change notifications", function(db) {
  var notified = 0;
  db.getRealRoot().subscribe(this, function() {
    notified += 1;
  });

  ok(db.createAccount(act({"name":"Test"})), "create account 1");
  equal(notified, 1, "Adding an account notifies root (child list)");

  ok(db.createAccount(act({"name":"Test2"})), "create account 2");
  equal(notified, 2, "Adding an account (2) notifies root (child list)");

  db.getRealRoot().unsubscribe(this);

  ok(db.createAccount(act({"name":"Test3"})), "create account 3");
  equal(notified, 2, "Adding an account (3) does NOT notify because we unsub'd");

  var notified2 = 0;
  db.getRealRoot().subscribe(this, function() {
    notified2 += 1;
  });

  ok(db.createAccount(act({"name":"Test4"})), "create account 4");
  equal(notified, 2, "Adding an account (4) does NOT notify because we unsub'd");
  equal(notified2, 1, "Adding an account (4) notifies second subscription");

  var notified3 = 0;
  var testAccount = db.getRealRoot().children.get("Test");
  ok(testAccount);
  var testAccountGuid = testAccount.data.guid;
  testAccount.subscribe(this, function() {
    notified3 += 1;
  });

  db.createAccount(act({"name":"Sub", "parent_guid":testAccountGuid}));
  var sub = testAccount.children.get("Sub");
  ok(sub);
  equal(notified3, 1);
  equal(notified2, 1);
  equal(notified, 2);

  ok(db.createAccount(act({"name":"Test5"})), "create account 5");
  equal(notified3, 1);
  equal(notified2, 2);
  equal(notified, 2);

  var notified4 = 0;
  var subscriber2 = {};
  db.getRealRoot().subscribe(subscriber2, function() {
    notified4 += 1;
  });

  ok(db.createAccount(act({"name":"Test6"})), "create account 6");
  equal(notified4, 1);
  equal(notified3, 1);
  equal(notified2, 3);
  equal(notified, 2);

  sub.update(act({"name": "WasSub"}))
  equal(notified4, 2);
  equal(notified3, 2);
  equal(notified2, 4);
  equal(notified, 2);

  db.getRealRoot().unsubscribe(this);
  testAccount.unsubscribe(this);
  ok(db.createAccount(act({"name":"Test7"})), "create account 7");
  equal(notified4, 3);
  equal(notified3, 2);
  equal(notified2, 4);
  equal(notified, 2);
});

dbtest("restore data from IDB", function(db) {
  // Create some data.
  var account1 = db.createAccount(act({"name":"Test"}));
  var account2 = db.createAccount(act({"name":"Test2"}));
  var sub =
      db.createAccount(act({"name":"Sub", "parent_guid": account1.data.guid}));
  ok(account1, "create account 1");
  ok(account2, "create account 2");
  ok(sub, "create sub account");

  var txn1 = db.createTransaction({
    description: "Transaction 1",
    timestamp: new Date().getTime(),
    entry: [
      {"account_guid": sub.data.guid, "amount": "1"},
      {"account_guid": account2.data.guid, "amount": "-1"},
    ]
  });

  forget();

  runTestWithDb(function(db2) {
    ok(db2 instanceof dblbook.DB, "created object is DB");
    var root = db2.getRealRoot();
    equal(2, root.children.size);

    var a1 = root.children.get("Test");
    var a2 = root.children.get("Test2");
    var sub = a1.children.get("Sub");

    ok(a1);
    ok(a2);
    ok(sub);

    var balance1 = a1.newBalanceReader()
    var fired1 = 0;
    balance1.subscribe(this, function() {
      fired1++;
    });

    equal(fired1, 0);
    equal(getValueFromIterator(balance1.iterator()).toString(), "$1.00");
  });
})

dbtest("balances", function(db) {
  var account1 = db.createAccount(act({"name":"Test"}));
  var balance1 = account1.newBalanceReader()
  var fired1 = 0;
  balance1.subscribe(this, function() {
    fired1++;
  });
  equal(fired1, 0);
  ok(getValueFromIterator(balance1.iterator()).isEmpty());

  var account2 = db.createAccount(act({"name":"Test2"}));
  var balance2 = account2.newBalanceReader()
  var fired2 = 0;
  balance2.subscribe(this, function() {
    fired2++;
  });
  ok(getValueFromIterator(balance2.iterator()).isEmpty());

  var sub = db.createAccount(act({"name":"Sub", "parent_guid": account1.data.guid}));
  var balanceSub = sub.newBalanceReader()
  var firedSub = 0;
  balanceSub.subscribe(this, function() {
    firedSub++;
  });
  ok(getValueFromIterator(balanceSub.iterator()).isEmpty());

  var txn1 = db.createTransaction({
    description: "Transaction 1",
    timestamp: new Date().getTime(),
    entry: [
      {"account_guid": sub.data.guid, "amount": "1"},
      {"account_guid": account2.data.guid, "amount": "-1"},
    ]
  });

  ok(txn1);
  equal(fired1, 1);
  equal(firedSub, 1);
  equal(fired2, 1);
  equal(getValueFromIterator(balance1.iterator()).toString(), "$1.00");
  equal(getValueFromIterator(balanceSub.iterator()).toString(), "$1.00");
  equal(getValueFromIterator(balance2.iterator()).toString(), "-$1.00");

  // Check readers created after transaction already exists.
  var balanceSub2 = sub.newBalanceReader()
  var firedSub2 = 0;
  balanceSub2.subscribe(this, function() {
    firedSub2++
  });
  equal(firedSub2, 0);
  equal(getValueFromIterator(balanceSub2.iterator()).toString(), "$1.00");

  // Update transaction and observe changes.
  txn1.update({
    description: "Transaction 1",
    timestamp: new Date().getTime(),
    entry: [
      {"account_guid": account1.data.guid, "amount": "2.50"},
      {"account_guid": account2.data.guid, "amount": "-2.50"},
    ]
  });

  equal(fired1, 2);
  equal(fired2, 2);
  equal(firedSub, 2);
  equal(firedSub2, 1);
  equal(getValueFromIterator(balance1.iterator()).toString(), "$2.50");
  equal(getValueFromIterator(balanceSub.iterator()).toString(), "$0.00");
  equal(getValueFromIterator(balance2.iterator()).toString(), "-$2.50");

  txn1.delete()
  equal(fired1, 3);
  equal(fired2, 3);
  equal(firedSub, 2);
  equal(firedSub2, 1);
  equal(getValueFromIterator(balance1.iterator()).toString(), "$0.00");
  equal(getValueFromIterator(balanceSub.iterator()).toString(), "$0.00");
  equal(getValueFromIterator(balance2.iterator()).toString(), "$0.00");
});
