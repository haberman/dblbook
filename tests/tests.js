// Makes the database forget that one has been previously constructed, to work
// around the code that enforces singleton.  This is necessary for tests where
// we want to verify that the DB was persisted correctly.
function forget() { dblbook.DB.created = undefined; }

function dbtest(name, func) {
  test(name, function() {
    // First delete the entire indexeddb.
    dblbook.obliterateDB(function() {
      // Next open a fresh DB from scratch.
      forget();
      dblbook.openDB(function(db) {
        ok(db instanceof dblbook.DB, "created object is DB");
        func(db);
        db.idb.close();
        start();
      });
    });
    stop();
  });
}

function numChildren(account) {
  return Object.keys(account.children).length;
}

test("transaction validity", function() {
  ok(!dblbook.transactionIsValid({}), "invalid txn 1");

  ok(dblbook.transactionIsValid({
    "timestamp": 12345,
    "description": "Foo Description",
    "entry": [
      {"account_guid": "fake_guid", "amount": [
        {"quantity": {"value": -1, "precision": 0}, "commodity": "USD"}
      ]},
      {"account_guid": "fake_guid2", "amount": [
        {"quantity": {"value": 1, "precision": 0}, "commodity": "USD"}
      ]},
    ]
  }), "valid txn 1");

  ok(!dblbook.transactionIsValid({
    "timestamp": 12345,
    "description": "Foo Description",
    "entry": [
      {"account_guid": "fake_guid", "amount": [
        {"quantity": {"value": 1, "precision": 0}, "commodity": "USD"}
      ]},
      {"account_guid": "fake_guid2", "amount": [
        {"quantity": {"value": 1, "precision": 0}, "commodity": "USD"}
      ]},
    ]
  }), "nonbalancing txn invalid");
});

test("account validity", function() {
  ok(!dblbook.accountIsValid({}), "invalid account 1");
  ok(dblbook.accountIsValid({"name":"Test"}), "valid account 1");
});

dbtest("empty DB", function(db) {
  ok(numChildren(db.getRootAccount()) == 0, "empty db has no accounts");
});

dbtest("multiple DBs not allowed", function() {
  dblbook.openDB(function(db, msg) {
    ok(db == null);
    start();
  });
  stop();
});

dbtest("CRUD account", function(db) {
  throws(function() {
    db.updateAccount({"name":"Test", "guid": "not-exists"})
  }, "can't update a non-existent account");

  throws(function() {
    db.createAccount({"name":"Test", "parent_guid": "not-exists"})
  }, "can't create an account if parent doesn't exist");

  ok(numChildren(db.getRootAccount()) == 0);
  ok(db.createAccount({"name":"Test"}), "create account 1");
  ok(numChildren(db.getRootAccount()) == 1, "now there is one account");
  var account = db.getRootAccount().children["Test"];
  ok(account.data.guid, "created account has a guid");
  ok(account.data.name == "Test", "created account has correct name");
  ok(account.db === db, "created account has correct db");
  ok(account.parent === db.getRootAccount(), "created account top as parent");
  ok(numChildren(account) == 0, "created account has no children");

  var account1_guid = account.data.guid;

  var sub = db.createAccount({"name":"Sub", "parent_guid":account1_guid});
  ok(sub, "create account 2");

  ok(numChildren(account) == 1, "now Test account has sub-account");

  // Move account to the top level.
  ok(db.updateAccount({"guid":sub.data.guid, "name":"Sub"}));

  ok(numChildren(db.getRootAccount()) == 2, "top-level now has two accounts");
  ok(numChildren(account) == 0, "Test no longer has sub-account");

  throws(function() {
    db.createAccount({"name":"Test"})
  }, "can't create account with duplicate name");
});

dbtest("Change notifications", function(db) {
  var notified = 0;
  db.subscribe(this, db.getRootAccount(), function() {
    notified += 1;
  });

  ok(db.createAccount({"name":"Test"}), "create account 1");
  equal(notified, 1, "Adding an account notifies root (child list)");

  ok(db.createAccount({"name":"Test2"}), "create account 2");
  equal(notified, 2, "Adding an account (2) notifies root (child list)");

  db.unsubscribe(this);

  ok(db.createAccount({"name":"Test3"}), "create account 3");
  equal(notified, 2, "Adding an account (3) does NOT notify because we unsub'd");

  var notified2 = 0;
  db.subscribe(this, db.getRootAccount(), function() {
    notified2 += 1;
  });

  ok(db.createAccount({"name":"Test4"}), "create account 4");
  equal(notified, 2, "Adding an account (4) does NOT notify because we unsub'd");
  equal(notified2, 1, "Adding an account (4) notifies second subscription");

  var notified3 = 0;
  var testAccount = db.getRootAccount().children["Test"];
  ok(testAccount);
  var testAccountGuid = testAccount.data.guid;
  db.subscribe(this, testAccount, function() {
    notified3 += 1;
  });

  var sub = db.createAccount({"name":"Sub", "parent_guid":testAccountGuid});
  equal(notified3, 1);
  equal(notified2, 1);
  equal(notified, 2);

  ok(db.createAccount({"name":"Test5"}), "create account 5");
  equal(notified3, 1);
  equal(notified2, 2);
  equal(notified, 2);

  var notified4 = 0;
  var subscriber2 = {};
  db.subscribe(subscriber2, db.getRootAccount(), function() {
    notified4 += 1;
  });

  ok(db.createAccount({"name":"Test6"}), "create account 6");
  equal(notified4, 1);
  equal(notified3, 1);
  equal(notified2, 3);
  equal(notified, 2);

  db.unsubscribe(this);
  ok(db.createAccount({"name":"Test7"}), "create account 7");
  equal(notified4, 2);
  equal(notified3, 1);
  equal(notified2, 3);
  equal(notified, 2);
});
