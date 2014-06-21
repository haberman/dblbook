/**
 * @fileoverview Core data types for amounts, balances, currencies, etc.
 * Inspired by Ledger (http://ledger-cli.org).
 * @author jhaberman@gmail.com (Josh Haberman)
 */

"use strict";

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

function merge(obj1, obj2) {
  var ret = {};
  for (var attrname in obj1) { ret[attrname] = obj1[attrname]; }
  for (var attrname in obj2) { ret[attrname] = obj2[attrname]; }
  return ret;
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

/** dblbook.SortedMap *********************************************************/

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

/** dblbook.Decimal ***********************************************************/

/**
 * Class for representing decimal numbers losslessly (unlike binary floating
 * point).  Takes inspiration from the "decimal" module from the Python standard
 * library.
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
 * Converts this object to the given precision (which may either extend or
 * truncate the previous precision).
 * @param {Number} precision The new precision.
 */
dblbook.Decimal.prototype.toPrecision = function(precision) {
  this.value = this.value * Math.pow(10, precision - this.precision);
  this.value = Math.round(this.value);
  this.precision = precision;
};

/**
 * Adds the given Decimal to this one.
 * @param {Decimal} other The number to add to this one.
 */
dblbook.Decimal.prototype.add = function(other) {
  // Result has precision that is the max of the two input precisions.
  var precision = Math.max(this.precision, other.precision);
  this.toPrecision(precision);
  var otherValue = other.value * Math.pow(10, precision - other.precision);
  this.value += Math.round(otherValue);
};

/**
 * Returns a new object is this subtracted from "other".
 * @param {Decimal} other The number to subtract from this one.
 * @return {Decimal} The difference.
 */
dblbook.Decimal.prototype.sub = function(other) {
  // Result has precision that is the max of the two input precisions.
  var precision = Math.max(this.precision, other.precision);
  this.toPrecision(precision);
  var otherValue = other.value * Math.pow(10, precision - other.precision);
  this.value -= Math.round(otherValue);
};

dblbook.Decimal.prototype.dup = function() {
  return new dblbook.Decimal(this.value, this.precision);
};

/**
 * Returns true iff the value is zero.
 */
dblbook.Decimal.prototype.isZero = function() {
  return this.value == 0;
}

/**
 * Converts the Decimal object to a string, retaining all significant digits.
 * @return {String} The string representation.
 */
dblbook.Decimal.prototype.toString = function() {
  var str = (this.value / Math.pow(10, this.precision)).toFixed(this.precision);
  // Add commas.
  return str.replace(/\B(?=(?:\d{3})+(?!\d))/g, ",");
};

/** dblbook.Balance ***********************************************************/

/**
 * Class for representing the balance of an account.  Contains a set of decimal
 * balances and their associated commodities (currencies).
 * @constructor
 */
dblbook.Balance = function(commodity, amount) {
  this.commodities = new Map();
  if (commodity) {
    if (!amount) {
      // Is 2 a good default for this?
      amount = new dblbook.Decimal(0, 2);
    } else if (!(amount instanceof dblbook.Decimal)) {
      amount = new dblbook.Decimal(amount);
    }
    this.commodities.set(commodity, amount);
    this.primary = commodity;
  }
};

dblbook.Balance.prototype._apply = function(other, func) {
  iterate(other.commodities.entries(), function(commodity, val) {
    if (!this.commodities.has(commodity)) {
      this.commodities.set(commodity, new dblbook.Decimal());
    }

    var amt1 = this.commodities.get(commodity);
    var amt2 = other.commodities.get(commodity);

    func.call(amt1, amt2);

    if (amt1.isZero() && commodity != this.primary) {
      this.commodities.delete(commodity);
    }
  }, this);
};

/**
 * Adds the given balance to this one.
 * @param {Balance} amount The balance to add.
 */
dblbook.Balance.prototype.add = function(other) {
  this._apply(other, dblbook.Decimal.prototype.add);
}

/**
 * Subtracts the given balance from this one.
 * @param {Balance} amount The balance to subtract.
 */
dblbook.Balance.prototype.sub = function(other) {
  this._apply(other, dblbook.Decimal.prototype.sub);
}

dblbook.Balance.prototype.dup = function() {
  var self = this;
  var ret = new dblbook.Balance(this.primary);
  iterate(this.commodities.entries(), function(commodity, val) {
    ret.commodities.set(commodity, val.dup());
  });
  return ret;
};

dblbook.Balance.prototype.toString = function() {
  var strs = new Array();
  iterate(this.commodities.entries(), function(commodity, val) {
    // Special-case commodities with common symbols.
    if (commodity == "USD") {
      val = val.toString();
      var isNegative = false;
      if (val.substring(0, 1) == "-") {
        isNegative = true;
        val = val.substring(1);
      }
      val = "$" + val;
      if (isNegative) {
        val = "-" + val;
      }
      strs.push(val);
    } else {
      strs.push(val + " " + commodity);
    }
  });
  var ret = strs.join(", ");
  return ret;
}

dblbook.Balance.prototype.isEmpty = function() {
  if (this.commodities.size == 0) {
    return true;
  }

  if (this.commodities.size == 1 &&
      this.commodities.get(this.primary) &&
      this.commodities.get(this.primary).isZero()) {
    return true;
  }

  return false;
}

dblbook.isArray = function(val) {
  // cf. http://stackoverflow.com/questions/4775722/check-if-object-is-array
  return Object.prototype.toString.call(val) === '[object Array]';
}

/** dblbook.Observable ********************************************************/

/**
 * Observable interface / base class.
 *
 * Objects that inherit from this (dblbook.Account, dblbook.Transaction, and
 * dblbook.Reader) allow you to receive notification when the object changes.
 */
dblbook.Observable = function() {
  this.subscribers = new Map();
}

/**
 * Registers this callback, which will be called whenever this object changes.
 * Any callback previously registered for this subcriber will be replaced.
 *
 * Note that subscribing to an object only gives you notifications for when
 * that object itself changes.  It does not give you notifications when related
 * information changes.  For example, subscribing to a dblbook.Account does
 * not deliver change notifications when transactions are added to the account,
 * because transactions are not directly available from the Account object.
 */
dblbook.Observable.prototype.subscribe = function(subscriber, callback) {
  if (this.subscribers.size == 0 && this._notifyHasSubscribers) {
    this._notifyHasSubscribers();
  }
  this.subscribers.set(subscriber, callback);
}

/**
 * Unregisters any previously registered callback for this subscriber.
 */
dblbook.Observable.prototype.unsubscribe = function(subscriber) {
  var wasEmpty = this.subscribers.size == 0;
  this.subscribers.delete(subscriber);
  if (!wasEmpty && this.subscribers.size == 0 && this._notifyNoSubscribers) {
    this._notifyNoSubscribers();
  }
}

/**
 * Internal-only function for calling all subscribers that the object has
 * changed.
 */
dblbook.Observable.prototype._notifyChange = function() {
  // Important: must gather the callbacks into an array first, because
  // delivering the notification can call back into unsubscribe().
  var callbacks = iterToArray(this.subscribers.values());
  for (var i in callbacks) {
    callbacks[i]();
  }
}

/** dblbook.DB ****************************************************************/

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
  this.accountsByGuid.set("REAL_ROOT", new dblbook.Account(this, {
    "name": "Real Root Account (internal)",
    "guid": "REAL_ROOT",
    "type": "ASSET",
    "commodity_guid": "USD"
  }));
  this.accountsByGuid.set("NOMINAL_ROOT", new dblbook.Account(this, {
    "name": "Nominal Root Account (internal)",
    "guid": "NOMINAL_ROOT",
    "type": "INCOME",
    "commodity_guid": "USD"
  }));

  // Key is [decimal usec][guid].
  this.transactionsByTime = new dblbook.SortedMap();
  this.transactionsByGuid = new Map();

  this._loadAccounts(callback.bind(null, this));
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

      self._loadTransactions(callback);
    }
  }
}

/**
 * Internal-only method to load transactions; calls callback when finished.
 * Right now we immediately and unconditionally load all transactions; we will
 * want to replace this with lazy loading.
 */
dblbook.DB.prototype._loadTransactions = function(callback) {
  var self = this;

  // It's confusing but there are two different kinds of transactions going on
  // here: IndexedDB database transactions and the app-level financial
  // transactions we are loading.
  var dbTxn = this.idb.transaction("transactions", "readonly");

  dbTxn.objectStore("transactions").openCursor().onsuccess = function(event) {
    var cursor = event.target.result;
    if (cursor) {
      var txn = new dblbook.Transaction(self, cursor.value);
      cursor.continue();
    } else {
      // Finished reading transactions.
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
dblbook.DB.prototype.transactionIsValid = function(txnData) {
  if (!dblbook.Transaction.isValid(txnData)) {
    return false;
  }

  if (this.unbalancedAmount(txnData)) {
    return false;
  }

  for (var i in txnData.entry) {
    var entry = txnData.entry[i]
    if (!this.accountsByGuid.has(entry.account_guid)) {
      return false;
    }
  }

  return true;
}

/**
 * If the transaction is unbalanced, returns the unbalanced balance.
 * Otherwise, (if the transaction is balanced), returns null.
 */
dblbook.DB.prototype.unbalancedAmount = function(txnData) {
  var unbalanced = new dblbook.Balance();

  for (var i in txnData.entry) {
    var entry = txnData.entry[i]
    if (typeof entry.account_guid != "string" ||
        typeof entry.amount != "string") {
      return false;
    }

    var account = this.accountsByGuid.get(entry.account_guid);
    var amount = new dblbook.Decimal(entry.amount);
    var entryAmount = new dblbook.Balance(account.data.commodity_guid, amount);
    unbalanced.add(entryAmount);
  }

  if (unbalanced.isEmpty()) {
    return null;
  } else {
    return unbalanced;
  }
}

/**
 * Internal-only method that returns a indexedDB transaction for writing to
 * the given stores.
 *
 * @return {IDBTransaction} An indexedDB transaction.
 */
dblbook.DB.prototype._getWriteTransaction = function() {
  var self = this;

  if (!this.txn) {
    this.txn = this.idb.transaction(["accounts", "transactions"], "readwrite");

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
  var txn = this._getWriteTransaction();
  txn.objectStore("accounts").add(accountData);
  return ret;
}

/**
 * Adds a transaction.  The transaction must be valid.  The guid should not
 * be set.
 *
 * @param {Transaction} transaction The transaction to add.
 */
dblbook.DB.prototype.createTransaction = function(transactionData) {
  var ret = new dblbook.Transaction(this, transactionData);
  var txn = this._getWriteTransaction();
  txn.objectStore("transactions").add(transactionData);
  return ret;
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

/** dblbook.Account ***********************************************************/

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
  this.readers = new Set();

  if (!dblbook.Account.isValid(data)) {
    throw "invalid account";
  }

  if (data.guid) {
    if (this.db.getAccountByGuid(data.guid)) {
      throw "Tried to duplicate existing account";
    }
  } else {
    data.guid = dblbook.guid();
  }

  if (data.guid != rootForType(data.type)) {
    var parentGuid = data.parent_guid || rootForType(data.type);
    this.parent = this.db.getAccountByGuid(parentGuid);

    if (!this.parent) {
      throw "parent account does not exist.";
    }

    if (this.parent.children.has(data.name)) {
      throw "account already exists with this name";
    }
  }

  Object.freeze(data);

  this.db.accountsByGuid.set(data.guid, this);

  if (this.parent) {
    this.parent.children.set(data.name, this);
    this.parent._notifyChange();
  }
}

// Account extends Observable.
//
// Subscribing to an account only notifies you about changes in the Account
// *definition* (like its name, parent, children, type).
//
// Subscribing to an account does *not* notify you about any transaction or
// balance data about the account.  For that, create a Reader and subscribe
// to it.
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
      typeof rootForType(accountData.type) == "string" &&
      typeof accountData.commodity_guid == "string";
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

  if (this.data.guid == rootForType(this.data.type)) {
    throw "Cannot update a root account.";
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

  var txn = this.db._getWriteTransaction();
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
  var txn = this.db._getWriteTransaction();
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
 * }
 */
dblbook.Account.prototype.newBalanceReader = function(options) {
  var defaults = {
    type: "balance",
    count: 1,
    end: new Date(),
    delta: false,
    frequency: "FOREVER",
    includeChildren: true
  };

  // TODO: validate options.

  var opts = merge(options, defaults);
  return new dblbook.Reader(this, opts);
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
 *
 * Note: the Reader is only considered to change when the *set* of transactions
 * changes.  The actual *contents* of the transactions are not monitored; to
 * keep track of those, subscribe to the contained Transactions themselves.
 */
dblbook.Account.prototype.newTransactionReader = function(options) {
  return new dblbook.Reader(this, options, this._updateTransactions);
}

/**
 * Internal-only method called when a reader gains at least one subscriber.
 * The Reader is linked to the Account when it is created, but the Account
 * only tracks and updates it when it has at least one subscriber.
 */
dblbook.Account.prototype._addReader = function(reader) {
  this.readers.add(reader);

  // Need to calculate its initial value(s).
  var opts = reader.options;

  if (opts.type == "balance") {
    if (opts.frequency != "FOREVER" ||
        opts.delta ||
        opts.count != 1) {
      throw "Unsupported configuration."
    }

    var balance = opts.includeChildren ?
        new dblbook.Balance(this.data.commodity_guid) : new dblbook.Decimal();

    iterate(this.db.transactionsByTime.iterator(), function(key, txn) {
      var info = txn.getAccountInfo(this.data.guid);

      if (info) {
        var amount = opts.includeChildren ? info.totalAmount : info.amount;
        balance.add(amount);
      }
    }, this);

    reader.values = [balance];
  }
}

/**
 * Internal-only method called when a reader loses its last subscriber.
 * When this happens the Account will stop tracking and updating this reader.
 */
dblbook.Account.prototype._removeReader = function(reader) {
  this.readers.delete(reader);
}

/**
 * Internal-only method called when a transaction for this account changes.
 */
dblbook.Account.prototype._onTransactionChange = function(txn) {
  var self = this;
  iterate(this.readers.values(), function(reader) {
    var opts = reader.options;

    if (opts.type == "balance") {
      var oldInfo = txn.getOldAccountInfo(this.data.guid);
      var newInfo = txn.getAccountInfo(this.data.guid);

      if (oldInfo) {
        var oldAmount =
            opts.includeChildren ? oldInfo.totalAmount : oldInfo.amount;
        reader.values[0].sub(oldAmount);
      }

      if (newInfo) {
        var newAmount =
            opts.includeChildren ? newInfo.totalAmount : newInfo.amount;
        reader.values[0].add(newAmount);
      }
    }

    reader._notifyChange();
  }, this);
}

/** dblbook.Transaction *******************************************************/

/**
 * dblbook.Transaction: object representing a transaction in the database.
 *
 * Contains these properties:
 * - db: link back to the database
 * - data: the raw data for this Transaction (as in model.proto)
 */
dblbook.Transaction = function(db, txnData) {
  dblbook.Observable.call(this);

  this.db = db;
  this.data = txnData;

  if (!this.db.transactionIsValid(txnData)) {
    throw "invalid transaction";
  }

  if (txnData.guid) {
    if (this.db.transactionsByGuid[txnData.guid]) {
      throw "Tried to duplicate existing transaction.";
    }
  } else {
    txnData.guid = dblbook.guid();
  }

  Object.freeze(txnData);

  this.db.transactionsByGuid.set(txnData.guid, this);
  this.db.transactionsByTime.add(this._byTimeKey(), this);
  this.accountInfo = new Map();
  this._updateAccountInfo();
}

// Transaction extends Observable.
dblbook.Transaction.prototype = Object.create(dblbook.Observable.prototype);
dblbook.Transaction.prototype.constructor = dblbook.Transaction;

/**
 * Returns true if the given transaction is valid in isolation.
 *
 * Does not validate things external to this transaction, like that all of the
 * accounts must exist.
 *
 * We also can't validate that the amounts balance here, because we don't know
 * the currency/commodity of the referenced accounts.
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
        typeof entry.amount != "string") {
      return false;
    }
  }

  return true;
}

/**
 * Returns info about this transaction pertaining to the given account.
 * If there is no entry for this account (or any sub-account) in this
 * transaction, returns null.
 *
 *  - description: effective description (including defaulting txn's).
 *  - date: either string postdate (for display) or JS Date object from txn.
 *  - amount: dblbook.Decimal: amount for this txn for this specific account.
 *  - totalAmount: dblbook.Balance: amount for this txn in this and all
 *    sub-accounts.
 */
dblbook.Transaction.prototype.getAccountInfo = function(accountGuid) {
  return this.accountInfo.get(accountGuid);
}

/**
 * Returns the previous account info for this account, or null if not.
 */
dblbook.Transaction.prototype.getOldAccountInfo = function(accountGuid) {
  return this.oldAccountInfo.get(accountGuid);
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
 * Internal-only method that should be called whenever the transaction data
 * changes, which will update the internal data that is derived from the raw
 * transaction data.
 *
 * Also triggers notifications to anyone watching the transaction, and to any
 * register or time series objects that depend on this data.
 */
dblbook.Transaction.prototype._updateAccountInfo = function() {
  // Create new accountInfo for all accounts in the transaction (and their
  // parents).
  this.oldAccountInfo = this.accountInfo;
  this.accountInfo = new Map();

  for (var i in this.data.entry) {
    var entry = this.data.entry[i];
    var entryAccount = this.db.getAccountByGuid(entry.account_guid);
    var entryAccountIsLeaf = (entryAccount.children.size == 0);
    var account = entryAccount;

    do {
      var guid = account.data.guid;
      var info = this.accountInfo.get(guid)
      var isEntryAccount = (account == entryAccount);

      if (!info) {
        info = {
          description: this.data.description,
          date: this.date,
          amount: new dblbook.Decimal(),
          totalAmount: new dblbook.Balance()
        };

        if (isEntryAccount && entry.description) {
          info.description = entry.description;
        }

        if (isEntryAccount && entryAccountIsLeaf && entry.postdate) {
          info.date = entry.postdate;
        }

        this.accountInfo.set(guid, info);
      }

      var amountBalance =
          new dblbook.Balance(account.data.commodity_guid, entry.amount);
      info.totalAmount.add(amountBalance);
      info.amount.add(new dblbook.Decimal(entry.amount));
    } while ((account = account.parent) != null);
  }

  // Triggers updates (and notifications) to any time series or transaction
  // reader objects.
  iterate(this.accountInfo.keys(), function(guid) {
    this.db.getAccountByGuid(guid)._onTransactionChange(this);
  }, this);

  // Triggers notifications to any objects watching the transaction itself.
  this._notifyChange();
}

/**
 * Internal only method to calculate the key for this transaction in the sorted
 * map.
 */
dblbook.Transaction.prototype._byTimeKey = function() {
  return this.data.timestamp.toString() + this.data.guid;
}


/** dblbook.Reader ************************************************************/

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
dblbook.Reader = function(account, options, calculate) {
  dblbook.Observable.call(this);
  this.account = account;
  this.options = options;
}

// Reader extends Observable.
dblbook.Reader.prototype = Object.create(dblbook.Observable.prototype);
dblbook.Reader.prototype.constructor = dblbook.Reader;

/**
 * Returns a ES6-style iterator to whatever data is available for this Reader.
 *
 * If the data is not loaded yet, the iterator may return a short count or no
 * data at all.
 *
 * The iterator is invalidated by any change to the database, or even
 * asynchronous loading, so the caller should consume all of the data before
 * giving up control.
 */
dblbook.Reader.prototype.iterator = function() {
  return new dblbook.ReaderIterator(this.values);
}

dblbook.Reader.prototype._notifyHasSubscribers = function() {
  this.account._addReader(this);
}

dblbook.Reader.prototype._notifyNoSubscribers = function() {
  this.account._removeReader(this);
}

/** dblbook.ReaderIterator ****************************************************/

dblbook.ReaderIterator = function(values) {
  this.values = values;
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
