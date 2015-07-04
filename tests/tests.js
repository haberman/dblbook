
import * as dataModel from 'data-model';
import * as qunit from 'qunit';

// Makes the database forget that one has been previously constructed, to work
// around the code that enforces singleton.  This is necessary for tests where
// we want to verify that the DB was persisted correctly.
function forget() { dataModel.DB.singleton = undefined; }

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


function runTestWithDb(func, assert) {
  var done = assert.async();
  dataModel.DB.open().then(function(db) {
    qunit.ok(db instanceof dataModel.DB, "created object is DB");
    func(db, assert);
    db.close();
    done();
  }, function(error) {
    console.log(error);
    qunit.ok(false);
    done();
  });
}

function getValueFromIterator(iter) {
  var pair = iter.next();
  qunit.ok(!pair.done);
  var ret = pair.value;
  qunit.ok(iter.next().done);
  return ret;
}

function dbtest(name, func) {
  qunit.test(name, function(assert) {
    var done = assert.async();

    // First delete the entire indexeddb.
    dataModel.DB.delete().then(function() {
      // Next open a fresh DB from scratch.
      forget();
      runTestWithDb(func, assert);
      done();
    });
  });
}

dbtest("transaction validity", function(db) {
  qunit.ok(!dataModel.Transaction.isValid({}), "invalid txn 1");

  var account1 = db.createAccount(act({"name":"Test2"}));
  var account2 = db.createAccount(act({"name":"Test"}));
  qunit.ok(account1);
  qunit.ok(account2);

  var guid1 = account1.data.guid;
  var guid2 = account2.data.guid;

  qunit.ok(db.transactionIsValid({
    "timestamp": 12345,
    "description": "Foo Description",
    "entry": [
      {"account_guid": guid1, "amount": "1"},
      {"account_guid": guid2, "amount": "-1"},
    ]
  }), "valid txn 1");

  qunit.ok(!db.transactionIsValid({
    "timestamp": 12345,
    "description": "Foo Description",
    "entry": [
      {"account_guid": guid1, "amount": "1"},
      {"account_guid": guid2, "amount": "1"},
    ]
  }), "nonbalancing txn invalid");
});

qunit.test("account validity", function() {
  qunit.ok(!dataModel.Account.isValid({}), "invalid account 1");
  qunit.ok(dataModel.Account.isValid({
    "name":"Test", "type": "ASSET", "commodity_guid": "USD"
  }), "valid account 1");
});

qunit.test("decimal", function() {
  var isTrulyZero = function(zero) {
    qunit.ok(zero.isZero(), "zero value isZero()");
    qunit.ok(zero.toString() == "0", "zero value has 0 representation");
  }

  var zero = new dataModel.Decimal();
  qunit.ok(zero, "no-arg constructor");
  isTrulyZero(zero);
  zero.add(zero);
  isTrulyZero(zero);
  zero.add(new dataModel.Decimal())
  isTrulyZero(zero);

  var val = new dataModel.Decimal("1.1");
  equal(val.value, 11);
  equal(val.precision, 1);
  qunit.ok(!val.isZero());

  var other = new dataModel.Decimal("200.02");
  equal(other.value, 20002);
  equal(other.precision, 2);
  qunit.ok(!other.isZero());

  val.add(other);
  equal(val.value, 20112);
  equal(val.precision, 2);
  qunit.ok(!val.isZero());

  var neg = new dataModel.Decimal("-76000.007");
  equal(neg.value, -76000007);
  equal(neg.precision, 3);
  equal("-76,000.007", neg.toString());
  qunit.ok(!neg.isZero());

  var sum2 = zero.dup();
  sum2.add(neg);
  equal(sum2.value, -76000007);
  equal(sum2.precision, 3);
  equal("-76,000.007", sum2.toString());
  qunit.ok(!sum2.isZero());
});

qunit.test("balance", function() {
  var empty = new dataModel.Balance();
  qunit.ok(empty.isEmpty());
  equal(empty.toString(), "");

  var emptyWithCurrency = new dataModel.Balance("USD");
  qunit.ok(emptyWithCurrency.isEmpty());
  equal(emptyWithCurrency.toString(), "$0.00");

  var bal = new dataModel.Balance();
  bal.add(new dataModel.Balance());
  qunit.ok(bal.isEmpty());

  bal.add(emptyWithCurrency);
  qunit.ok(bal.isEmpty());

  bal.add(new dataModel.Balance("USD", "5.23"));
  equal(bal.toString(), "$5.23");
});

dbtest("empty DB", function(db) {
  qunit.ok(db.getRealRoot().children.size == 0, "empty db has no accounts");
  qunit.ok(db.getNominalRoot().children.size == 0, "empty db has no accounts");
});

dbtest("multiple DBs not allowed", function(db, assert) {
  var err = false;
  var done = assert.async();
  try {
    dataModel.DB.open().then(function(db) {
      qunit.ok(false);
      done();
    }, function() {
      err = true;
    });
  } catch (e) {
    done();
  }
});

dbtest("CRUD account", function(db) {
  throws(function() {
    db.createAccount(act({"name":"Test", "parent_guid": "not-exists" }));
  }, "can't create an account if parent doesn't exist");

  qunit.ok(db.getRealRoot().children.size == 0);
  qunit.ok(db.createAccount(act({"name":"Test"})), "create account 1");
  qunit.ok(db.getRealRoot().children.size == 1, "now there is one account");

  var account = db.getRealRoot().children.get("Test");
  qunit.ok(account.data.guid, "created account has a guid");
  qunit.ok(account.data.name == "Test", "created account has correct name");
  qunit.ok(account.db === db, "created account has correct db");
  qunit.ok(account.parent === db.getRealRoot(), "created account top as parent");
  qunit.ok(account.children.size == 0, "created account has no children");

  var account1_guid = account.data.guid;

  var sub = db.createAccount(act({"name":"Sub", "parent_guid":account1_guid}));
  qunit.ok(sub, "create account 2");

  qunit.ok(account.children.size == 1, "now Test account has sub-account");

  // Move account to the top level.
  sub.update(act({"name":"Sub"}));

  qunit.ok(db.getRealRoot().children.size == 2, "top-level now has two accounts");
  qunit.ok(account.children.size == 0, "Test no longer has sub-account");

  throws(function() {
    db.createAccount(act({"name":"Test"}))
  }, "can't create account with duplicate name");

  qunit.ok(db.createAccount(act({ "guid": "EXPLICIT GUID", "name": "YO"})),
     "can create an account with an explicit GUID set.");
});

dbtest("Change notifications", function(db) {
  var notified = 0;
  db.getRealRoot().subscribe(this, function() {
    notified += 1;
  });

  qunit.ok(db.createAccount(act({"name":"Test"})), "create account 1");
  equal(notified, 1, "Adding an account notifies root (child list)");

  qunit.ok(db.createAccount(act({"name":"Test2"})), "create account 2");
  equal(notified, 2, "Adding an account (2) notifies root (child list)");

  db.getRealRoot().unsubscribe(this);

  qunit.ok(db.createAccount(act({"name":"Test3"})), "create account 3");
  equal(notified, 2, "Adding an account (3) does NOT notify because we unsub'd");

  var notified2 = 0;
  db.getRealRoot().subscribe(this, function() {
    notified2 += 1;
  });

  qunit.ok(db.createAccount(act({"name":"Test4"})), "create account 4");
  equal(notified, 2, "Adding an account (4) does NOT notify because we unsub'd");
  equal(notified2, 1, "Adding an account (4) notifies second subscription");

  var notified3 = 0;
  var testAccount = db.getRealRoot().children.get("Test");
  qunit.ok(testAccount);
  var testAccountGuid = testAccount.data.guid;
  testAccount.subscribe(this, function() {
    notified3 += 1;
  });

  db.createAccount(act({"name":"Sub", "parent_guid":testAccountGuid}));
  var sub = testAccount.children.get("Sub");
  qunit.ok(sub);
  equal(notified3, 1);
  equal(notified2, 1);
  equal(notified, 2);

  qunit.ok(db.createAccount(act({"name":"Test5"})), "create account 5");
  equal(notified3, 1);
  equal(notified2, 2);
  equal(notified, 2);

  var notified4 = 0;
  var subscriber2 = {};
  db.getRealRoot().subscribe(subscriber2, function() {
    notified4 += 1;
  });

  qunit.ok(db.createAccount(act({"name":"Test6"})), "create account 6");
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
  qunit.ok(db.createAccount(act({"name":"Test7"})), "create account 7");
  equal(notified4, 3);
  equal(notified3, 2);
  equal(notified2, 4);
  equal(notified, 2);
});

dbtest("restore data from IDB", function(db, assert) {
  // Create some data.
  var account1 = db.createAccount(act({"name":"Test"}));
  var account2 = db.createAccount(act({"name":"Test2"}));
  var sub =
      db.createAccount(act({"name":"Sub", "parent_guid": account1.data.guid}));
  qunit.ok(account1, "create account 1");
  qunit.ok(account2, "create account 2");
  qunit.ok(sub, "create sub account");

  db.createTransaction({
    description: "Transaction 1",
    timestamp: new Date().getTime(),
    entry: [
      {"account_guid": sub.data.guid, "amount": "1"},
      {"account_guid": account2.data.guid, "amount": "-1"},
    ]
  });

  forget();

  runTestWithDb(function(db2) {
    qunit.ok(db2 instanceof dataModel.DB, "created object is DB");
    var root = db2.getRealRoot();
    equal(2, root.children.size);

    var a1 = root.children.get("Test");
    var a2 = root.children.get("Test2");
    var sub = a1.children.get("Sub");

    qunit.ok(a1);
    qunit.ok(a2);
    qunit.ok(sub);

    var balance1 = a1.newBalanceReader()
    var fired1 = 0;
    balance1.subscribe(this, function() {
      fired1++;
    });

    equal(fired1, 0);
    equal(getValueFromIterator(balance1.iterator()).toString(), "$1.00");
  }, assert);
})

dbtest("balances", function(db) {
  var account1 = db.createAccount(act({"name":"Test"}));
  var balance1 = account1.newBalanceReader()
  var fired1 = 0;
  balance1.subscribe(this, function() {
    fired1++;
  });
  equal(fired1, 0);
  qunit.ok(getValueFromIterator(balance1.iterator()).isEmpty());

  var account2 = db.createAccount(act({"name":"Test2"}));
  var balance2 = account2.newBalanceReader()
  var fired2 = 0;
  balance2.subscribe(this, function() {
    fired2++;
  });
  qunit.ok(getValueFromIterator(balance2.iterator()).isEmpty());

  var sub = db.createAccount(act({"name":"Sub", "parent_guid": account1.data.guid}));
  var balanceSub = sub.newBalanceReader()
  var firedSub = 0;
  balanceSub.subscribe(this, function() {
    firedSub++;
  });
  qunit.ok(getValueFromIterator(balanceSub.iterator()).isEmpty());

  var txn1 = db.createTransaction({
    description: "Transaction 1",
    timestamp: new Date().getTime(),
    entry: [
      {"account_guid": sub.data.guid, "amount": "1"},
      {"account_guid": account2.data.guid, "amount": "-1"},
    ]
  });

  qunit.ok(txn1);
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
