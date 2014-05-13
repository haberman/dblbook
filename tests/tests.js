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
