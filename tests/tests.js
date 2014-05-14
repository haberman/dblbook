// Makes the database forget that one has been previously constructed, to work
// around the code that enforces singleton.  This is necessary for tests where
// we want to verify that the DB was persisted correctly.
function forget() { dblbook.DB.created = undefined; }

function dbtest(name, func) {
  test(name, function() {
    forget();
    dblbook.openDB(function(db) {
      ok(db instanceof dblbook.DB, "created object is DB");
      func(db);
      start();
    });
    stop();
  });
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
  deepEqual(db.transactions(), [], "empty db has empty transactions");
  deepEqual(db.accounts(), [], "empty db has empty accounts");
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

  ok(db.createAccount({"name":"Test"}), "create account 1");
  ok(db.accounts().length == 1, "now there is one account");
  ok(db.accounts()[0].data.guid, "created account has a guid");
  ok(db.accounts()[0].data.name == "Test", "created account has correct name");
  ok(db.accounts()[0].db === db, "created account has correct db");
  ok(!db.accounts()[0].parent, "created account has no parent");
  deepEqual(db.accounts()[0].children, [], "created account has no children");

  var account1_guid = db.accounts()[0].data.guid;

  ok(db.createAccount({"name":"Sub", "parent_guid":account1_guid}),
     "create account 2");
});
