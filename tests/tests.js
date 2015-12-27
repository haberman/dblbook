
import * as model from 'model';
import * as qunit from 'qunit';

// Makes the database forget that one has been previously constructed, to work
// around the code that enforces singleton.  This is necessary for tests where
// we want to verify that the DB was persisted correctly.
function forget() { model.DB.singleton = undefined; }

// Add account defaults.
var act = function(data) {
  if (!data.type) {
    data.type = "ASSET";
  }
  return data;
}


function runTestWithDb(func, assert) {
  var done = assert.async();
  model.DB.open().then(function(db) {
    qunit.ok(db instanceof model.DB, "created object is DB");
    func(db, assert);
    db.close();
    done();
  }, function(error) {
    console.log(error);
    qunit.ok(false);
    done();
  });
}

function arrayFrom(iter) {
  var ret = [];
  while (1) {
    var v = iter.next();
    if (v.done) {
      return ret;
    }
    ret.push(v.value);
  }
}

function getSingleArrayValue(array) {
  qunit.equal(array.length, 1, "Array has exactly one element");
  return array[0];
}

function assertPointIsZero(point) {
  qunit.ok(point.startBalance.isZero());
  qunit.ok(point.endBalance.isZero());
}

function dbtest(name, func) {
  qunit.test(name, function(assert) {
    var done = assert.async();

    // First delete the entire indexeddb.
    model.DB.delete().then(function() {
      // Next open a fresh DB from scratch.
      forget();
      runTestWithDb(func, assert);
      done();
    });
  });
}

dbtest("transaction validity", function(db) {
  qunit.ok(!model.Transaction.isValid({}), "invalid txn 1");

  var account1 = db.createAccount(act({"name":"Test2"}));
  var account2 = db.createAccount(act({"name":"Test"}));
  qunit.ok(account1);
  qunit.ok(account2);

  var guid1 = account1.data.guid;
  var guid2 = account2.data.guid;

  qunit.ok(db.transactionIsValid({
    "date": "2015-09-23",
    "description": "Foo Description",
    "entry": [
      {"account_guid": guid1, "amount": {"USD":"1.00"}},
      {"account_guid": guid2, "amount": {"USD":"-1.00"}},
    ]
  }), "valid txn 1");

  qunit.ok(!db.transactionIsValid({
    "date": "2015-09-23",
    "description": "Foo Description",
    "entry": [
      {"account_guid": guid1, "amount": {"USD":"1.00"}},
      {"account_guid": guid2, "amount": {"USD":"1.00"}},
    ]
  }), "nonbalancing txn invalid");

  qunit.ok(!db.transactionIsValid({
    "date": "2015-09-23",
    "description": "Foo Description",
    "entry": [
      {"account_guid": guid1, "amount": {"USD":"1.00"}},
      {"account_guid": guid2, "amount": {"EUR":"-1.00"}},
    ]
  }), "nonbalancing txn invalid 2");
});

qunit.test("account validity", function() {
  qunit.ok(!model.Account.isValid({}), "invalid account 1");
  qunit.ok(model.Account.isValid({
    "name":"Test", "type": "ASSET", "commodity_guid": "USD"
  }), "valid account 1");
});

dbtest("empty DB", function(db) {
  qunit.ok(db.getRealRoot().children.size == 0, "empty db has no accounts");
  qunit.ok(db.getNominalRoot().children.size == 0, "empty db has no accounts");
});

dbtest("multiple DBs not allowed", function(db, assert) {
  var err = false;
  var done = assert.async();
  try {
    model.DB.open().then(function(db) {
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
    date: "2015-09-23",
    entry: [
      {"account_guid": sub.data.guid, "amount": {"USD":"1.00"}},
      {"account_guid": account2.data.guid, "amount": {"USD": "-1.00"}},
    ]
  });

  forget();

  runTestWithDb(function(db2, assert) {
    qunit.ok(db2 instanceof model.DB, "created object is DB");
    var root = db2.getRealRoot();
    equal(2, root.children.size);

    var a1 = root.children.get("Test");
    var a2 = root.children.get("Test2");
    var sub = a1.children.get("Sub");

    qunit.ok(a1, "account 1 exists");
    qunit.ok(a2, "account 2 exists");
    qunit.ok(sub, "sub-account exists");

    let done = assert.async();
    let balance1 = a1.newBalanceReader({frequency: "FOREVER"});
    model.Observable.whenLoaded([balance1], function() {
      var fired1 = 0;
      balance1.subscribe(this, function() {
        fired1++;
      });

      equal(fired1, 0, "callback hasn't been fired yet");
      let val = getSingleArrayValue(balance1.getPoints());
      equal(val.endBalance.toString(), "$1.00", "Balance is as expected");
      done();
    });
  }, assert);
})

dbtest("balances", function(db, assert) {
  var account1 = db.createAccount(act({"name":"Test"}));
  var account2 = db.createAccount(act({"name":"Test2"}));
  var sub = db.createAccount(act({"name":"Sub", "parent_guid": account1.data.guid}));

  let balance1 = account1.newBalanceReader({frequency: "FOREVER"});
  var balance2 = account2.newBalanceReader({frequency: "FOREVER"})
  var balanceSub = sub.newBalanceReader({frequency: "FOREVER"})

  let done = assert.async();

  model.Observable.whenLoaded([balance1, balance2, balanceSub], function() {
    qunit.ok(balance1, "successfully created balance reader");

    var fired1 = 0;
    var fired2 = 0;
    var firedSub = 0;

    balance1.subscribe(this, function() {
      fired1++;
    });

    balance2.subscribe(this, function() {
      fired2++;
    });

    balanceSub.subscribe(this, function() {
      firedSub++;
    });

    equal(fired1, 0);
    equal(firedSub, 0);
    equal(fired2, 0);

    assertPointIsZero(getSingleArrayValue(balance1.getPoints()));
    assertPointIsZero(getSingleArrayValue(balance2.getPoints()));
    assertPointIsZero(getSingleArrayValue(balanceSub.getPoints()));

    var txn1 = db.createTransaction({
      description: "Transaction 1",
      date: "2015-09-23",
      entry: [
        {"account_guid": sub.data.guid, "amount": {"USD": "1.00"}},
        {"account_guid": account2.data.guid, "amount": {"USD": "-1.00"}},
      ]
    });

    qunit.ok(txn1);
    equal(fired1, 1);
    equal(firedSub, 1);
    equal(fired2, 1);
    equal(getSingleArrayValue(balance1.getPoints()).endBalance.toString(), "$1.00", "balance 1");
    equal(getSingleArrayValue(balanceSub.getPoints()).endBalance.toString(), "$1.00", "balance 2");
    equal(getSingleArrayValue(balance2.getPoints()).endBalance.toString(), "-$1.00", "balance 3");

    // Check readers created after transaction already exists.
    var balanceSub2 = sub.newBalanceReader({frequency: "FOREVER"})
    var firedSub2 = 0;
    balanceSub2.subscribe(this, function() {
      firedSub2++
    });
    equal(firedSub2, 0);
    equal(getSingleArrayValue(balanceSub2.getPoints()).endBalance.toString(), "$1.00", "newly created reader works");

    // Update transaction and observe changes.
    txn1.update({
      description: "Transaction 1",
      date: "2015-09-23",
      entry: [
        {"account_guid": account1.data.guid, "amount": {"USD": "2.50"}},
        {"account_guid": account2.data.guid, "amount": {"USD": "-2.50"}},
      ]
    });

    equal(fired1, 2, "check gid");
    equal(fired2, 2, "check diq");
    equal(firedSub, 2, "check qox");
    equal(firedSub2, 1, "check ofh");
    equal(getSingleArrayValue(balance1.getPoints()).endBalance.toString(), "$2.50", "txn update propagated 1");
    equal(getSingleArrayValue(balanceSub.getPoints()).endBalance.toString(), "0", "txn update propagated 2");
    equal(getSingleArrayValue(balance2.getPoints()).endBalance.toString(), "-$2.50", "txn update propagated 3");

    txn1.delete()
    equal(fired1, 3, "check xzy");
    equal(fired2, 3, "check zaa");
    equal(firedSub, 2, "check sdb");
    equal(firedSub2, 1, "check qeo");
    equal(getSingleArrayValue(balance1.getPoints()).endBalance.toString(), "0");
    equal(getSingleArrayValue(balanceSub.getPoints()).endBalance.toString(), "0");
    equal(getSingleArrayValue(balance2.getPoints()).endBalance.toString(), "0");

    done();
  });

});

dbtest("entries", function(db, assert) {
  let salary = db.createAccount({
    name: "Salary",
    type: "INCOME"
  });

  let food = db.createAccount({
    name: "Food",
    type: "EXPENSE"
  });

  let groceries = db.createAccount({
    name: "Groceries",
    type: "EXPENSE",
    parent_guid: food.data.guid
  });

  let restaurants = db.createAccount({
    name: "Restaurants",
    type: "EXPENSE",
    parent_guid: food.data.guid
  });

  let checking = db.createAccount({
    name: "Checking",
    type: "ASSET"
  });

  let paycheckTxn = db.createTransaction({
    description: "Paycheck",
    date: "2015-09-23",
    entry: [
      {"account_guid": salary.data.guid, "amount": {"USD": "-1000.00"}},
      {"account_guid": checking.data.guid, "amount": {"USD": "1000.00"}},
    ]
  });

  let groceriesTxn = db.createTransaction({
    description: "Groceries at Safeway",
    date: "2015-09-25",
    entry: [
      {"account_guid": checking.data.guid, "amount": {"USD": "-123.45"}},
      {"account_guid": groceries.data.guid, "amount": {"USD": "123.45"}},
    ]
  });

  let pizzaHutTxn = db.createTransaction({
    description: "Dinner at Pizza Hut",
    date: "2015-09-27",
    entry: [
      {"account_guid": checking.data.guid, "amount": {"USD": "-45.20"}},
      {"account_guid": restaurants.data.guid, "amount": {"USD": "45.20"}},
    ]
  });

  // Added out of order.
  let dinnerTxn = db.createTransaction({
    description: "Dinner with takeout",
    date: "2015-09-26",
    entry: [
      {"account_guid": checking.data.guid, "amount": {"USD": "-60.00"}},
      {"account_guid": restaurants.data.guid, "amount": {"USD": "40.00"}},
      {"account_guid": groceries.data.guid, "amount": {"USD": "20.00"}},
    ]
  });

  let groceriesEntries = groceries.newEntryReader({
    startDate: "2015-09-22",
    count: 8
  });
  let realEntries = db.getRealRoot().newEntryReader({
    startDate: "2015-09-22",
    count: 5
  });
  let shortRealEntries = db.getRealRoot().newEntryReader({
    startDate: "2015-09-27",
    count: 2
  });

  /*
  let groceriesBalances = groceries.newBalanceReader({
    startDate: "2015-09-22",
    frequency: "DAY",
    count: 8
  });
  let realBalances = db.getRealRoot().newBalanceReader({
    startDate: "2015-09-22",
    frequency: "DAY",
    count: 8
  });
  */

  let done = assert.async();

  function assertEntries(entries, expectedEntries) {
    assert.equal(entries.length, expectedEntries.length);
    for (let i = 0; i < Math.min(entries.length, expectedEntries.length); i++) {
      let entry = entries[i];
      let [entryAmount, balance, txn] = expectedEntries[i];
      assert.deepEqual(entry.entry.amount.toString(), entryAmount);
      assert.deepEqual(entry.balance.toString(), balance);
      assert.equal(entry.entry.txn, txn);
    }
  }

  model.Observable.whenLoaded([groceriesEntries,
                               realEntries,
                               shortRealEntries/*,
                               groceriesBalances,
                               realBalances*/], function() {
    let entries = realEntries.getEntries();
    assertEntries(realEntries.getEntries(), [
      ["$1000.00", "$1000.00", paycheckTxn],
      ["-$123.45", "$876.55", groceriesTxn],
      ["-$60.00", "$816.55", dinnerTxn],
      ["-$45.20", "$771.35", pizzaHutTxn],
    ]);

    entries = shortRealEntries.getEntries();
    assertEntries(shortRealEntries.getEntries(), [
      ["-$45.20", "$771.35", pizzaHutTxn],
    ]);
    done();
  });
});
