/**
 * @fileoverview Core data types for amounts, balances, currencies, etc.
 * Inspired by Ledger (http://ledger-cli.org).
 * @author jhaberman@gmail.com (Josh Haberman)
 */

var dblbook = {};

dblbook.guid = function() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    var r = Math.random()*16|0, v = c == 'x' ? r : (r&0x3|0x8);
    return v.toString(16);
  });
}

dblbook.appendNested = function(base, key1, key2, val) {
  if (!base.get(key1)) {
    base.set(key1, new Map());
  }
  base.get(key1).set(key2, val);
}

dblbook.removeNested = function(base, key1, key2) {
  var sub = base.get(key1);
  sub.delete(key2);
  if (sub.size == 0) {
    base.delete(key1);
  }
}

function iterToArray(iter) {
  var ret = [];
  while (1) {
    var v = iter.next();
    if (v.done) {
      return ret;
    }
    ret.push(v.value);
  }
}

// Iterates over a ES6-style iterator.
function iterate(iter, func, funcThis) {
  while (1) {
    var v = iter.next();
    if (v.done) {
      return;
    }

    var val = v.value;

    if (val instanceof Array) {
      // iterate(map.entries(), function(key, val) {});
      func.apply(funcThis, val);
    } else {
      // iterate(map.values(), function(val) {});
      func.call(funcThis, val);
    }
  }
}

function toposort(nodes) {
  var cursor = nodes.length;
  var sorted = new Array(cursor);
  var visited = {};
  var i = cursor;
  var byGuid = {};

  nodes.forEach(function(node) { byGuid[node.guid] = node });

  while (i--) {
    if (!visited[i]) visit(nodes[i], i, [])
  }

  return sorted

  function visit(node, i, predecessors) {
    if(predecessors.indexOf(node) >= 0) {
      throw new Error('Cyclic dependency: '+JSON.stringify(node))
    }

    if (visited[i]) return;
    visited[i] = true

    // outgoing edges
    var outgoing = node.parent_guid ? [byGuid[node.parent_guid]] : []
    if (i = outgoing.length) {
      var preds = predecessors.concat(node)
      do {
        var child = outgoing[--i]
        visit(child, nodes.indexOf(child), preds)
      } while (i)
    }

    sorted[--cursor] = node
  }
}

function rootForType(type) {
  if (type == "ASSET" || type == "LIABILITY") {
    return "REAL_ROOT";
  } else if (type == "INCOME" || type == "EXPENSE") {
    return "NOMINAL_ROOT";
  } else {
    throw "Unexpected account type " + type;
  }
}

/**
 * An ES6-compatible iterator for SortedMap.
 */
dblbook.SortedMapIterator = function(rbIter) {
  this.rbIter = rbIter;
  this.done = false;
}

dblbook.SortedMapIterator.prototype.next = function() {
  var item;
  if (this.done || (item = this.rbIter.next()) == null) {
    this.done = true;
    return {"done": true};
  } else {
    return {
      "value": item,
      "done": false,
    }
  }
}

/**
 * Sorted string -> value map.
 */
dblbook.SortedMap = function() {
  this.tree = new RBTree(dblbook.SortedMap._compare);

  Object.defineProperty(this, "size", {
    "get": function() { return this.tree.size; }
  });
}

dblbook.SortedMap._compare = function(e1, e2) {
  var k1 = e1[0];
  var k2 = e2[0];
  if (k1 < k2) {
    return -1;
  } else if (k2 < k1) {
    return 1;
  } else {
    return 0;
  }
}

/**
 * Sets the given key/value pair in the map, throwing an error if this key
 * is already in the map.
 */
dblbook.SortedMap.prototype.add = function(key, val) {
  var ok = this.tree.insert([key, val]);
  if (!ok) {
    throw "Key was already present.";
  }
}

/**
 * Sets the given key/value pair in the map, overwriting any previous value
 * for "key".
 */
dblbook.SortedMap.prototype.set = function(key, val) {
  this.tree.remove([key, null]);
  this.tree.insert([key, val]);
}

/**
 * Removes the given key from the map, if present.
 * for "key".
 */
dblbook.SortedMap.prototype.delete = function(key) {
  this.tree.remove([key, null]);
}

/**
 * Returns true if the given key is in the map.
 */
dblbook.SortedMap.prototype.has = function(key) {
  return this.tree.find([key, null]) != null;
}

/**
 * Returns the value for this key if it exists, otherwise null.
 */
dblbook.SortedMap.prototype.get = function(key) {
  var val = this.tree.find([key, null]);
  return val ? val[1] : null;
}

/**
 * Returns an iterator over the map's entries, in key order.
 */
dblbook.SortedMap.prototype.iterator = function() {
  return new dblbook.SortedMapIterator(this.tree.iterator());
}

/**
 * Class for representing decimal numbers losslessly (unlike binary floating
 * point).  Instances are immutable.  Takes inspiration from the "decimal"
 * module from the Python standard library.
 *
 * Can be constructed in two ways:
 * @param {String} value The string that should be converted to a Decimal
 * object.  The number of digits following the decimal point indicates
 * the number of significant digits, so Decimal("0.1") is less precise than
 * Decimal("0.10").
 *
 * @param {Number} value The integer representing this number's value without
 * a decimal point.
 * @param {Number} precision The number of decimal digits to the right of
 * the decimal point.
 * For example, to construct the number 12.34, call new Decimal(1234, 2).
 * @constructor
 */
dblbook.Decimal = function(value, precision) {
  if (typeof(value) == "undefined") {
    this.value = 0;
    this.precision = 0;
  } else if (typeof(value) == "string") {
    var parts = value.split(".");
    var isNegative = false;
    if (parts[0].charAt(0) == "-") {
      isNegative = true;
      parts[0] = parts[0].slice(1);
    }
    var intParts = parts.map(function(x) { return parseInt(x, 10); })
    if (parts.length == 2) {
      this.precision = parts[1].length;
      this.value = intParts[1] + (intParts[0] * Math.pow(10, this.precision));
    } else if (parts.length == 1) {
      this.precision = 0;
      this.value = intParts[0];
    } else {
      throw "Invalid decimal number: " + value
    }
    if (isNegative) { this.value = -this.value; }
  } else if (typeof(value) == "number") {
    this.value = value;
    this.precision = precision;
  } else {
    this.value = value.value;
    this.precision = value.precision;
  }
};

/**
 * Returns an object with the same value of this but with the given precision
 * (which may either extend or truncate the previous precision).
 * @param {Number} precision The new precision to use.
 * @return {Decimal} The new value.
 */
dblbook.Decimal.prototype.toPrecision = function(precision) {
  var value = this.value * Math.pow(10, precision - this.precision);
  var ret = new dblbook.Decimal(Math.round(value), precision);
  return ret;
};

/**
 * Returns a new object whose value is this added to "other".
 * @param {Decimal} other The number to add to this one.
 * @return {Decimal} The sum.
 */
dblbook.Decimal.prototype.add = function(other) {
  // Result has precision that is the max of the two input precisions.
  var precision = Math.max(this.precision, other.precision);
  var op1 = this.toPrecision(precision);
  var op2 = other.toPrecision(precision);
  var ret = new dblbook.Decimal(op1.value + op2.value, precision);
  return ret;
};

/**
 * Returns a new object that is the negation of this.
 * @return {Decimal} The negation.
 */
dblbook.Decimal.prototype.neg = function() {
  return new dblbook.Decimal(-this.value, this.precision);
};

/**
 * Returns a new object is this subtracted from "other".
 * @param {Decimal} other The number to subtract from this one.
 * @return {Decimal} The difference.
 */
dblbook.Decimal.prototype.sub = function(other) {
  return this.add(other.neg());
};

/**
 * Converts the Decimal object to a string, retaining all significant digits.
 * @return {String} The string representation.
 */
dblbook.Decimal.prototype.toString = function() {
  var str = (this.value / Math.pow(10, this.precision)).toFixed(this.precision);
  // Add commas.
  return str.replace(/\B(?=(?:\d{3})+(?!\d))/g, ",");
};

/**
 * Class for representing the balance of an account.  Contains a set of decimal
 * balances and their associated commodities (currencies).
 * @constructor
 */
dblbook.Balance = function(amounts) {
  this.commodities = {};
  for (var i in amounts) {
    var amount = amounts[i];
    this.commodities[amount.commodity] = new dblbook.Decimal(amount.quantity);
  }
  /* For string construction
  if (data) {
    var arr = str.match(/\$?(-?[0-9]*\.[0-9]+|[0-9]+)/);
    if (!arr) throw "Yikes.";
    this.commodities['USD'] = new dblbook.Decimal(arr[0]);
  }
  */
};

/**
 * Adds the given amount in the given commodity to this balance.
 * @param {Balance} amount The balance to add.
 */
dblbook.Balance.prototype.add = function(other) {
  var ret = this.dup();
  for (var commodity in other.commodities) {
    if (!(commodity in this.commodities)) {
      ret.commodities[commodity] = new dblbook.Decimal();
    }
    var sum = ret.commodities[commodity].add(other.commodities[commodity]);
    if (sum.toString() == "0") {
      delete ret.commodities[commodity];
    } else {
      ret.commodities[commodity] = sum;
    }
  }
  return ret;
};

dblbook.Balance.prototype.dup = function() {
  var ret = new dblbook.Balance();
  for (var commodity in this.commodities) {
    ret.commodities[commodity] = this.commodities[commodity];
  }
  return ret;
};

dblbook.Balance.prototype.toString = function() {
  var strs = new Array();
  for (var commodity in this.commodities) {
    // Special-case commodities with common symbols.
    if (commodity == "USD") {
      strs.push("$" + this.commodities[commodity]);
    } else {
      strs.push(this.commodities[commodity] + " " + commodity);
    }
  }
  var ret = strs.join(", ");
  return ret;
}

dblbook.isArray = function(val) {
  // cf. http://stackoverflow.com/questions/4775722/check-if-object-is-array
  return Object.prototype.toString.call(val) === '[object Array]';
}

/**
 * Observable interface / base class.
 *
 * Objects that inherit from this (dblbook.Account and dblbook.Reader) allow
 * you to receive notification when the object changes.
 *
 */
dblbook.Observable = function() {
  this.subscribers = new Map();
}

/**
 * Registers this callback, which will be called whenever this object
 * changes.  Any callback previously registered for this subcriber will
 * be replaced.
 */
dblbook.Observable.prototype.subscribe = function(subscriber, callback) {
  this.subscribers.set(subscriber, callback);
}

/**
 * Unregisters any previously registered callback for this subscriber.
 */
dblbook.Observable.prototype.unsubscribe = function(subscriber) {
  this.subscribers.delete(subscriber);
}

/**
 * Internal-only function for calling all subscribers that the object has
 * changed.
 */
dblbook.Observable.prototype._notifyChange = function() {
  iterate(this.subscribers.values(), function(cb) { cb(); });
}

/**
 * The top-level "database" object that contains all accounts and transactions
 * for some person or organization.
 *
 * Together with the Account, Transaction, and Reader types, this object
 * provides a full r/w interface to all information kept in the application.
 *
 * All changes are immediately saved into a local indexedDB.  When this object
 * is constructed, it reads all data from the indexedDB to restore to the last
 * saved state.
 *
 * This object must not be constructed directly; a database should be opened
 * with DB.open below.
 *
 * @constructor
 */
dblbook.DB = function(idb, callback) {
  var self = this;

  this.idb = idb;

  this.accountsByGuid = new Map();
  this.accountsByGuid.set("REAL_ROOT", new dblbook.Account(this));
  this.accountsByGuid.set("NOMINAL_ROOT", new dblbook.Account(this));

  this.subscriptionsByObj = new Map();
  this.subscriptionsBySubscriber = new Map();

  var i = 2;
  var barrier = function() {
    if (--i == 0) {
      callback(self);
    }
  }

  this._loadAccounts(barrier);
  this._loadTransactions(barrier);
}

/**
 * Internal-only method to load accounts; calls callback when finished.
 */
dblbook.DB.prototype._loadAccounts = function(callback) {
  var self = this;
  var txn = this.idb.transaction("accounts", "readonly");
  var accounts = []

  txn.objectStore("accounts").openCursor().onsuccess = function(event) {
    var cursor = event.target.result;
    if (cursor) {
      accounts.push(cursor.value);
      cursor.continue();
    } else {
      // Need to ensure that we add parent accounts before children.
      accounts = toposort(accounts);
      accounts.reverse();

      accounts.forEach(function(account) {
        var account = new dblbook.Account(self, account);
      });

      callback();
    }
  }
}

/**
 * Internal-only method to load transactions; calls callback when finished.
 * Right now we immediately and unconditionally load all transactions; we will
 * want to replace this with lazy loading.
 */
dblbook.DB.prototype._loadTransactions = function(callback) {
  callback();
  return;
  var self = this;
  var txn = this.idb.transaction("transactions", "readonly");
  var accounts = []

  txn.objectStore("accounts").openCursor().onsuccess = function(event) {
    var cursor = event.target.result;
    if (cursor) {
      accounts.push(cursor.value);
      cursor.continue();
    } else {
      // Need to ensure that we add parent accounts before children.
      accounts = toposort(accounts);
      accounts.reverse();

      accounts.forEach(function(account) {
        var account = new dblbook.Account(self, account);
      });

      callback();
    }
  }
}


/**
 * Internal-only method to load transactions; calls callback when finished.
 */

/**
 * Opens the database, calling callback(db) when it is opened successfully.
 */
dblbook.DB.open = function(callback) {
  var version = 1;
  var request = indexedDB.open("dblbook", version);

  request.onupgradeneeded = function(e) {
    var idb = request.result;
    var store = idb.createObjectStore("transactions", {keyPath: "guid"});
    var date_order = store.createIndex("time_order", "timestamp")

    store = idb.createObjectStore("accounts", {keyPath: "guid"});
  }

  request.onblocked = function(e) {
    alert("Oops!");
    console.log(e);
  }

  request.onsuccess = function() {
    var idb = request.result;

    if (dblbook.DB.singleton) {
      callback(null, "Only one DB object allowed");
      idb.close();
    } else {
      dblbook.DB.singleton = new dblbook.DB(idb, callback);
    }
  }

  request.onerror = function() {
    callback(null, "error opening IndexedDB");
  }
}

/**
 * Closes the DB object.  After this returns, you may not call any mutating
 * methods.
 */
dblbook.DB.prototype.close = function(account) {
  this.idb.close();
}

/**
 * Deletes the database (all data is completely lost!), calling "callback" when
 * it is completed successfully.
 */
dblbook.DB.delete = function(callback) {
  var request = indexedDB.deleteDatabase("dblbook");
  request.onsuccess = function() {
    callback();
  }
  request.onerror = function(event) {
    console.log("Error in obliterate", event);
  }
}

/**
 * Checks the validity of the given transaction, including that all of the
 * referenced accounts exist.
 *
 * @param txn Data for a transaction (as in model.proto).
 */
dblbook.DB.prototype.transactionIsValid = function(txn) {
  if (!dblbook.transactionIsValid(txn)) {
    return false;
  }

  for (var i in txn.entry) {
    var entry = txn.entry[i]
    if (!this.accountsByGuid.has(entry.account_guid)) {
      return false;
    }
  }

  return true;
}

/**
 * Internal-only method that returns a indexedDB transaction for writing to
 * the given stores.
 *
 * @return {IDBTransaction} An indexedDB transaction.
 */
dblbook.DB.prototype._getWriteTransaction = function(stores) {
  // TODO: take "stores" into account.

  var self = this;

  if (!this.txn) {
    this.txn = this.idb.transaction(stores, "readwrite");

    this.txn.onerror = function(event) {
      console.log("Whoa, did not see that coming.", event);
      alert("Transaction failure!");
    }

    this.txn.onsuccess = function(event) {
      self.txn = null;
    }
  }

  return this.txn;
}

/**
 * Adds a new account.  Constraints:
 *
 * 1. account guid may or may not be set (one will be assigned if not).
 * 2. account must be valid.Account name and type should be set, but guid should be
 *    unset (the object will assign one appropriately).
 * 3. the name must not be the same as any other account with this parent.
 *
 * @param accountData Data for the account to add (to match model.proto).
 */
dblbook.DB.prototype.createAccount = function(accountData) {
  var ret = new dblbook.Account(this, accountData);
  var txn = this._getWriteTransaction(["accounts"]);
  txn.objectStore("accounts").add(accountData);
  return ret;
}

/**
 * Adds a transaction.  The transaction must be valid.  The guid should not
 * be set.
 *
 * @param {Transaction} transaction The transaction to add.
 */
dblbook.DB.prototype.createTransaction = function(transaction) {
}

/**
 * Returns the root of the real account tree.
 *
 * The returned object is a dblbook.Account object, but it has no "data"
 * member.  You can retrieve its children and get a TimeSeries or Register
 * reader for it.  But you cannot update/delete it or give it any transactions.
 *
 * @return {dblbook.Account} The root of the real account tree.
 */
dblbook.DB.prototype.getRealRoot = function() {
  return this.accountsByGuid.get("REAL_ROOT");
}

/**
 * Returns the root of the nominal account tree.
 *
 * The returned object is a dblbook.Account object, but it has no "data"
 * member.  You can retrieve its children and get a TimeSeries or Register
 * reader for it.  But you cannot update/delete it or give it any transactions.
 *
 * @return {dblbook.Account} The root of the nominal account tree.
 */
dblbook.DB.prototype.getNominalRoot = function() {
  return this.accountsByGuid.get("NOMINAL_ROOT");
}

/**
 * Returns an account by its GUID.
 */
dblbook.DB.prototype.getAccountByGuid = function(guid) {
  return this.accountsByGuid.get(guid);
}

/**
 * Class for representing an account.
 *
 * These properties are provided, all of which are read-only:
 * - db: link back to the database
 * - data: the raw data for this Account (as in model.proto)
 * - parent: the parent account, or null if this is at the top level.
 * - children: an array of children, which may be empty.
 *
 * @constructor
 */
dblbook.Account = function(db, data) {
  dblbook.Observable.call(this);

  this.db = db;
  this.data = data;
  this.parent = null;
  this.children = new dblbook.SortedMap();

  if (!data) {
    // Root account.
    return;
  }

  var parentGuid = data.parent_guid || rootForType(data.type);
  this.parent = this.db.getAccountByGuid(parentGuid);

  if (!dblbook.Account.isValid(data)) {
    throw "invalid account";
  }

  if (!this.parent) {
    throw "parent account does not exist.";
  }

  if (this.parent.children.has(data.name)) {
    throw "account already exists with this name";
  }

  if (data.guid) {
    if (this.db.getAccountByGuid(data.guid)) {
      throw "Tried to duplicate existing account";
    }
  } else {
    data.guid = dblbook.guid();
  }

  Object.freeze(data);

  this.parent.children.set(data.name, this);
  this.db.accountsByGuid.set(data.guid, this);
  this.parent._notifyChange();
}

// Account extends Observable.
dblbook.Account.prototype = Object.create(dblbook.Observable.prototype);
dblbook.Account.prototype.constructor = dblbook.Account;

/**
 * Returns true if the given account is valid in isolation.
 * Does not validate things external to this account, like that the parent
 * account must exist.
 */
dblbook.Account.isValid = function(accountData) {
  var ret = typeof accountData.name == "string" &&
      typeof accountData.type == "string" &&
      typeof rootForType(accountData.type) == "string";
  if (!ret) {
    console.log("Invalid account: ", accountData);
  }
  return ret;
}

/**
 * Updates an account with the given data.
 */
dblbook.Account.prototype.update = function(newData) {
  if (!dblbook.Account.isValid(newData)) {
    throw "invalid account";
  }

  if (newData.guid) {
    if (newData.guid != this.data.guid) {
      throw "Cannot change account GUID.";
    }
  } else {
    // Specifying GUID in new data is not necessary.
    // TODO: should we extend this to all properties; ie. automatically merge
    // and remove properties with {property: null}?
    newData.guid = this.data.guid;
  }

  // Reparent the account.
  var newParentGuid = newData.parent_guid || rootForType(newData.type);
  var newParent = this.db.getAccountByGuid(newParentGuid);
  var oldParent = this.parent;

  if (!newParent) {
    throw "parent account does not exist.";
  }

  if (oldParent !== newParent || this.data.name != newData.name) {
    if (newParent.children.has(newData.name)) {
      throw "account already exists with this name";
    }

    oldParent.children.delete(this.data.name);
    newParent.children.set(newData.name, this);

    oldParent._notifyChange();
    newParent._notifyChange();

    this.parent = newParent;
  }

  Object.freeze(newData);

  this.data = newData;

  var txn = this.db._getWriteTransaction(["accounts"]);
  txn.objectStore("accounts").put(newData);
}

/**
 * Deletes an existing account.
 * The account must not have any transactions that reference it.
 */
dblbook.Account.prototype.delete = function() {
  // TODO: What is the right way to test this?
  //if (this.last) {
  //  throw "cannot delete account with any transactions";
  //}

  if (this.parent) {
    this.parent.children.delete(this.data.name);
    this.parent._notifyChange();
    // TODO:
    // Should we notify the account itself?
    // Then any view that depends on it could just
    // redirect somewhere else?
  }

  this.db.accountsByGuid.delete(this.data.guid);
  var txn = this.db._getWriteTransaction(["accounts"]);
  txn.objectStore("accounts").delete(this.data.guid);
}

/**
 * Returns a new Reader that vends a sequence of balances for this account
 * at different points in time.  Each iterated item is a pair of:
 *
 *   [Date, dblbook.Balance]
 *
 * Options (and their defaults) are: {
 *   // How many sample points should be part of the sequence.
 *   "count": 1,
 *
 *   // When the last point should be.
 *   "end": new Date(),
 *
 *   // When true, amounts indicate the *change* since the beginning of the
 *   // period, not the point-in-time balance of the account.
 *   //
 *   // Note that this has no effect when frequency = "FOREVER", since in that
 *   // case the delta and absolute balances are the same.
 *   "delta": false,
 *
 *   // Frequency of points.
 *   // Valid values are: "DAY", "WEEK", "MONTH", "QUARTER", "YEAR", "FOREVER".
 *   // "FOREVER" is only valid for count = 1.
 *   "frequency": "FOREVER",
 *
 *   // When true, amounts include transactions for all child accounts.
 *   "includeChildren": true,
 */
dblbook.Account.prototype.newBalanceReader = function(options) {
  return new dblbook.Reader();
}

/**
 * Returns a new Reader that vends a sequence of Transactions for this
 * account.  The iterated items are: dblbook.Transaction objects.
 *
 * Options (and their defaults) are: {
 *   // How many transactions should be part of the sequence.
 *   "count": 20,
 *
 *   // The first returned transaction will be the one directly at or before
 *   // this date.
 *   "end": new Date(),
 *
 *   // When true, list includes transactions for all child accounts.
 *   "includeChildren": true,
 * }
 *
 * Note: if this is a *leaf* account, the ordering will reflect the post date
 * if any (for the entry in this account).  For all non-leaf accounts, the
 * ordering reflects the transaction's time.
 */
dblbook.Account.prototype.newTransactionReader = function(options) {
}

/**
 * dblbook.Transaction: object representing a transaction in the database.
 *
 * Contains these properties:
 * - db: link back to the database
 * - data: the raw data for this Transaction (as in model.proto)
 */
dblbook.Transaction = function(db, data) {
  this.db = db;
  this.data = data;

  if (!this.transactionIsValid(txn)) {
    throw "invalid transaction";
  }

  if (txn.guid) {
    if (this.transactionsByGuid[txn.guid]) {
      throw "Tried to duplicate existing transaction.";
    }
  } else {
    txn.guid = dblbook.guid();
  }

  Object.freeze(txn);

  var txnObj = new dblbook.Transaction(this, txn)

  this.accountsByGuid.set(account.guid, txnObj);
  parent.children.set(account.name, txnObj);

  this._notifyChange(parent);

  return txnObj;
}

/**
 * If the transaction is unbalanced, returns the unbalanced balance.
 * Otherwise, (if the transaction is balanced), returns null.
 */
dblbook.Transaction.unbalancedAmount = function(txnData) {
  var unbalanced = new dblbook.Balance();

  for (var i in txnData.entry) {
    var entry = txnData.entry[i]
    if (typeof entry.account_guid != "string" ||
        !dblbook.isArray(entry.amount) ||
        entry.amount.length < 1) {
      return false;
    }
    unbalanced = unbalanced.add(new dblbook.Balance(entry.amount));
  }

  if (unbalanced.toString() == "") {
    return null;
  } else {
    return unbalanced;
  }
}

/**
 * Returns true if the given transaction is valid in isolation.
 * Does not validate things external to this transaction, like that all of the
 * accounts must exist.
 */
dblbook.Transaction.isValid = function(txnData) {
  if (typeof txnData.timestamp != "number" ||
      typeof txnData.description != "string" ||
      !dblbook.isArray(txnData.entry) ||
      txnData.entry.length < 2) {
    return false;
  }

  for (var i in txnData.entry) {
    var entry = txnData.entry[i]
    if (typeof entry.account_guid != "string" ||
        entry.account_guid == "REAL_ROOT" ||
        entry.account_guid == "NOMINAL_ROOT" ||
        !dblbook.isArray(entry.amount) ||
        entry.amount.length < 1) {
      return false;
    }
  }

  if (dblbook.Transaction.unbalancedAmount(txnData)) {
    return false;
  }

  return true;
}

/**
 * Returns info about this transaction pertaining to the given account.
 * If this account does not have an entry in this transaction, returns null.
 *
 *  - description: effective description (including defaulting txn's).
 *  - date: either string postdate (for display) or integer timestamp from txn.
 *  - amount: dblbook.Decimal: amount for this txn.
 *  - balance: dblbook.Balance: current cumulative balance for this account
 *    (includes all transactions for this account and all sub-accounts).
 */
dblbook.Transaction.prototype.getAccountInfo = function(accountGuid) {
}

/**
 * Updates an existing transaction.  Transaction guid must be set, and the
 * transaction must be valid.  This will completely overwrite the previous
 * value of this transaction.
 *
 * @param {Transaction} transaction The new value for this transaction.
 */
dblbook.Transaction.prototype.update = function(transactionData) {
}

/**
 * Deletes an existing transaction.
 *
 * @param {string} transactionGuid The guid of the transaction to delete.
 */
dblbook.Transaction.prototype.delete = function() {
}

/**
 * A Reader is an iterable object that is kept up-to-date whenever the DB
 * changes.
 *
 * For example, if you get a Reader for a Register (ie. a series of
 * transactions), you can iterate over it as many times as you want and it will
 * always return the up-to-date values for all transactions in the domain.
 *
 * Obtaining a reader will make the DB attempt to load the requested data, if
 * is not loaded already.  You can query the reader for whether the data is
 * currently loaded or not.
 *
 * You can specify a callback that will get called whenever the data changes.
 *
 * You *must* release() the reader when you are done with it, otherwise the DB
 * will be forced to keep the data loaded indefinitely and will also have to
 * keep calling the callback every time the data changes.
 *
 * @constructor
 */
dblbook.Reader = function() {
  dblbook.Observable.call(this);
}

// Reader extends Observable.
dblbook.Reader.prototype = Object.create(dblbook.Observable.prototype);
dblbook.Reader.prototype.constructor = dblbook.Reader;

dblbook.Reader.prototype.iterator = function() {
  return new dblbook.ReaderIterator();
}

/**
 * The Subscription protocol (see above).
 */
dblbook.Reader.prototype.subscribe = function(subscriber, callback) {
}

dblbook.Reader.prototype.unsubscribe = function(subscriber) {
}

dblbook.ReaderIterator = function() {
  this.values = ["$1000"];
  this.pos = 0;
}

dblbook.ReaderIterator.prototype.next = function() {
  if (this.pos < this.values.length) {
    return {
      value: this.values[this.pos++],
      done: false
    }
  } else {
    return {
      value: null,
      done: true
    }
  }
}
