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
});
