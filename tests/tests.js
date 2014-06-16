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
  ok(account1, "create account 1");
  ok(db.createAccount(act({"name":"Test2"})), "create account 2");
  ok(db.createAccount(act({"name":"Sub", "parent_guid": account1.data.guid})),
     "create sub account");

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
  });
})
