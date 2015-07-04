/**
 * @fileoverview Core data types for amounts, balances, currencies, etc.
 * Inspired by Ledger (http://ledger-cli.org).
 * @author jhaberman@gmail.com (Josh Haberman)
 */

"use strict";

import { RBTree } from 'bintrees';

function guid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    var r = Math.random()*16|0, v = c == 'x' ? r : (r&0x3|0x8);
    return v.toString(16);
  });
}

function isArray(val) {
  // cf. http://stackoverflow.com/questions/4775722/check-if-object-is-array
  return Object.prototype.toString.call(val) === '[object Array]';
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
class SortedMapIterator {
  constructor(rbIter, nextFunc) {
    this.rbIter = rbIter;
    this.nextFunc = nextFunc;
    this.done = false;
  }

  [Symbol.iterator]() {
    return this;
  }

  next() {
    let item;
    if (this.done || (item = this.rbIter[this.nextFunc]()) == null) {
      this.done = true;
      return {"done": true};
    } else {
      return {
        "value": item,
        "done": false,
      }
    }
  }
}

/** dblbook.SortedMap *********************************************************/

/**
 * Sorted string -> value map.
 */
class SortedMap {
  constructor() {
     this.tree = new RBTree(SortedMap._compare);

    Object.defineProperty(this, "size", {
      "get": function() { return this.tree.size; }
    });
  }

  static _compare(e1, e2) {
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
  add(key, val) {
    var ok = this.tree.insert([key, val]);
    if (!ok) {
      throw "Key was already present.";
    }
  }

  /**
   * Sets the given key/value pair in the map, overwriting any previous value
   * for "key".
   */
  set(key, val) {
    this.tree.remove([key, null]);
    this.tree.insert([key, val]);
  }

  /**
   * Removes the given key from the map, if present.
   * for "key".
   */
  delete(key) {
    this.tree.remove([key, null]);
  }

  /**
   * Returns true if the given key is in the map.
   */
  has(key) {
    return this.tree.find([key, null]) != null;
  }

  /**
   * Returns the value for this key if it exists, otherwise null.
   */
  get(key) {
    var val = this.tree.find([key, null]);
    return val ? val[1] : null;
  }

  /**
   * Returns an iterator over the map's entries, in key order.
   */
  iterator() {
    return new SortedMapIterator(this.tree.iterator(), "next");
  }

  /**
   * Returns an iterator over the map's entries, in reverse key order.
   */
  riterator() {
    return new SortedMapIterator(this.tree.iterator(), "prev");
  }
}

/** Decimal ***********************************************************/

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
export class Decimal {
  constructor(value, precision) {
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
  }

  /**
   * Converts this object to the given precision (which may either extend or
   * truncate the previous precision).
   * @param {Number} precision The new precision.
   */
  toPrecision(precision) {
    this.value = this.value * Math.pow(10, precision - this.precision);
    this.value = Math.round(this.value);
    this.precision = precision;
  }

  /**
   * Adds the given Decimal to this one.
   * @param {Decimal} other The number to add to this one.
   */
  add(other) {
    // Result has precision that is the max of the two input precisions.
    var precision = Math.max(this.precision, other.precision);
    this.toPrecision(precision);
    var otherValue = other.value * Math.pow(10, precision - other.precision);
    this.value += Math.round(otherValue);
  }

  /**
   * Returns a new object is this subtracted from "other".
   * @param {Decimal} other The number to subtract from this one.
   * @return {Decimal} The difference.
   */
  sub(other) {
    // Result has precision that is the max of the two input precisions.
    var precision = Math.max(this.precision, other.precision);
    this.toPrecision(precision);
    var otherValue = other.value * Math.pow(10, precision - other.precision);
    this.value -= Math.round(otherValue);
  }

  dup() {
    return new Decimal(this.value, this.precision);
  }

  /**
   * Returns true iff the value is zero.
   */
  isZero() {
    return this.value == 0;
  }

  /**
   * Converts the Decimal object to a string, retaining all significant digits.
   * @return {String} The string representation.
   */
  toString() {
    var str = (this.value / Math.pow(10, this.precision)).toFixed(this.precision);
    // Add commas.
    return str.replace(/\B(?=(?:\d{3})+(?!\d))/g, ",");
  }
}

/** Balance ***********************************************************/

/**
 * Class for representing the balance of an account.  Contains a set of decimal
 * balances and their associated commodities (currencies).
 * @constructor
 */
export class Balance {
  constructor(commodity, amount) {
    this.commodities = new Map();
    if (commodity) {
      if (!amount) {
        // Is 2 a good default for this?
        amount = new Decimal(0, 2);
      } else if (!(amount instanceof Decimal)) {
        amount = new Decimal(amount);
      }
      this.commodities.set(commodity, amount);
      this.primary = commodity;
    }
  }

  _apply(other, func) {
    for (let commodity of other.commodities.keys()) {
      if (!this.commodities.has(commodity)) {
        this.commodities.set(commodity, new Decimal());
      }

      var amt1 = this.commodities.get(commodity);
      var amt2 = other.commodities.get(commodity);

      func.call(amt1, amt2);

      if (amt1.isZero() && commodity != this.primary) {
        this.commodities.delete(commodity);
      }
    }
  }

  /**
   * Adds the given balance to this one.
   * @param {Balance} amount The balance to add.
   */
  add(other) {
    this._apply(other, Decimal.prototype.add);
  }

  /**
   * Subtracts the given balance from this one.
   * @param {Balance} amount The balance to subtract.
   */
  sub(other) {
    this._apply(other, Decimal.prototype.sub);
  }

  dup() {
    var ret = new Balance(this.primary);
    for (let [commodity, val] of this.commodities) {
      ret.commodities.set(commodity, val.dup());
    }
    return ret;
  }

  toString() {
    var strs = new Array();
    for (let [commodity, val] of this.commodities) {
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
    }
    var ret = strs.join(", ");
    return ret;
  }

  isEmpty() {
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
}

/** Observable ********************************************************/

/**
 * Observable interface / base class.
 *
 * Objects that inherit from this (Account, Transaction, and Reader) allow you
 * to receive notification when the object changes.
 */
class Observable {
  constructor() {
    this.subscribers = new Map();
  }

  /**
   * Registers this callback, which will be called whenever this object changes.
   * Any callback previously registered for this subcriber will be replaced.
   *
   * Note that subscribing to an object only gives you notifications for when
   * that object itself changes.  It does not give you notifications when related
   * information changes.  For example, subscribing to a Account does
   * not deliver change notifications when transactions are added to the account,
   * because transactions are not directly available from the Account object.
   */
  subscribe(subscriber, callback) {
    if (this.subscribers.size == 0 && this._notifyHasSubscribers) {
      this._notifyHasSubscribers();
    }
    this.subscribers.set(subscriber, callback);
  }

  /**
   * Unregisters any previously registered callback for this subscriber.
   */
  unsubscribe(subscriber) {
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
  _notifyChange() {
    // Important: must gather the callbacks into an array first, because
    // delivering the notification can call back into unsubscribe().
    var callbacks = iterToArray(this.subscribers.values());
    for (var i in callbacks) {
      callbacks[i]();
    }
  }
}

/** DB ****************************************************************/

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
export class DB {
  /**
   * Constructor is not public: clients should obtain new DB instances with
   * DB.open() below.
   */
  constructor(idb, callback) {
    this.idb = idb;

    this.accountsByGuid = new Map();
    this.accountsByGuid.set("REAL_ROOT", new Account(this, {
      "name": "Real Root Account (internal)",
      "guid": "REAL_ROOT",
      "type": "ASSET",
      "commodity_guid": "USD"
    }));
    this.accountsByGuid.set("NOMINAL_ROOT", new Account(this, {
      "name": "Nominal Root Account (internal)",
      "guid": "NOMINAL_ROOT",
      "type": "INCOME",
      "commodity_guid": "USD"
    }));

    // Key is [decimal usec][guid].
    this.transactionsByTime = new SortedMap();
    this.transactionsByGuid = new Map();
  }

  /**
   * Opens the database and loads initial values, returning a promise that will
   * provide a DB object in the success case.
   */
  static open() {
    let db = new DB()
    let initialized = false;

    if (DB.singleton) {
      throw Error("Only one DB object allowed");
    }
    DB.singleton = db;

    let openDb = function() {
      return new Promise(function(resolve, reject) {
        // Open Database, creating schema if necessary.
        var version = 1;
        var request = indexedDB.open("dblbook", version);

        request.onupgradeneeded = function(e) {
          var idb = request.result;
          var store = idb.createObjectStore("transactions", {keyPath: "guid"});
          store.createIndex("time_order", "timestamp")

          store = idb.createObjectStore("accounts", {keyPath: "guid"});
          initialized = true;
        }

        request.onblocked = function(e) {
          alert("Oops!");
          console.log(e);
          reject(Error("DB was blocked"))
        }

        request.onsuccess = function() {
          db.idb = request.result;

          // Set up behavior for what we'll do if the database changes versions
          // (or is deleted) out from under us.
          request.result.onversionchange = function(e) {
            if (e.newVersion === null) {
              db.idb.close();
            }
          }

          resolve();
        }

        request.onerror = function() {
          reject(Error("error opening IndexedDB"));
        }
      });
    }

    let loadAccounts = function() {
      return new Promise(function(resolve, reject) {
        // Load accounts.

        let txn = db.idb.transaction("accounts", "readonly");
        let accounts = []

        txn.objectStore("accounts").openCursor().onsuccess = function(event) {
          let cursor = event.target.result;
          if (cursor) {
            accounts.push(cursor.value);
            cursor.continue();
          } else {
            // End-of-stream.  Need to ensure that we add parent accounts before
            // children.
            accounts = toposort(accounts);
            accounts.reverse();

            accounts.forEach(function(account) { new Account(db, account); });

            resolve();
          }
        }
      });
    }

    let loadTransactions = function() {
      return new Promise(function(resolve, reject) {
        // Right now we immediately and unconditionally load all transactions; we will
        // want to replace this with lazy loading.

        // It's confusing but there are two different kinds of transactions going on
        // here: IndexedDB database transactions and the app-level financial
        // transactions we are loading.
        var dbTxn = db.idb.transaction("transactions", "readonly");

        dbTxn.objectStore("transactions").openCursor().onsuccess = function(event) {
          var cursor = event.target.result;
          if (cursor) {
            new Transaction(db, cursor.value);
            cursor.continue();
          } else {
            // Finished reading transactions.
            resolve(db);
          }
        }
      });
    }

    return openDb()
        .then(loadAccounts)
        .then(loadTransactions);
  }

  /**
   * Closes the DB object.  After this returns, you may not call any mutating
   * methods.
   */
  close(account) {
    this.idb.close();
  }

  /**
   * Deletes the database (all data is completely lost!), calling "callback" when
   * it is completed successfully.
   */
  static delete(callback) {
    return new Promise(function(resolve, reject) {
      var request = indexedDB.deleteDatabase("dblbook");
      request.onsuccess = function() {
        resolve();
      }
      request.onerror = function(event) {
        console.log("Error in obliterate", event);
        reject(new Error("Error in obliterate", event));
      }
    });
  }

  /**
   * Checks the validity of the given transaction, including that all of the
   * referenced accounts exist.
   *
   * @param txn Data for a transaction (as in model.proto).
   */
  transactionIsValid(txnData) {
    if (!Transaction.isValid(txnData)) {
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
  unbalancedAmount(txnData) {
    var unbalanced = new Balance();

    for (var i in txnData.entry) {
      var entry = txnData.entry[i]
      if (typeof entry.account_guid != "string" ||
          typeof entry.amount != "string") {
        return false;
      }

      var account = this.accountsByGuid.get(entry.account_guid);
      var amount = new Decimal(entry.amount);
      var entryAmount = new Balance(account.data.commodity_guid, amount);
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
  _getWriteTransaction() {
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
   * 2. account must be valid.  Account name and type must be set.  If the
   *    parent is set, it must exist.
   * 3. the name must not be the same as any other account with this parent.
   *
   * @param accountData Data for the account to add (to match model.proto).
   */
  createAccount(accountData) {
    var ret = new Account(this, accountData);
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
  createTransaction(transactionData) {
    var ret = new Transaction(this, transactionData);
    var txn = this._getWriteTransaction();
    txn.objectStore("transactions").add(transactionData);
    return ret;
  }

  /**
   * Returns the root of the real account tree.
   *
   * The returned object is a Account object, but it has no "data"
   * member.  You can retrieve its children and get a balance or transaction
   * Reader for it.  But you cannot update/delete it or give it any transactions.
   *
   * @return {Account} The root of the real account tree.
   */
  getRealRoot() {
    return this.accountsByGuid.get("REAL_ROOT");
  }

  /**
   * Returns the root of the nominal account tree.
   *
   * The returned object is a Account object, but it has no "data"
   * member.  You can retrieve its children and get a balance or transaction
   * Reader for it.  But you cannot update/delete it or give it any transactions.
   *
   * @return {Account} The root of the nominal account tree.
   */
  getNominalRoot() {
    return this.accountsByGuid.get("NOMINAL_ROOT");
  }

  /**
   * Returns an account by its GUID.
   */
  getAccountByGuid(guid) {
    return this.accountsByGuid.get(guid);
  }
}

/** Account ***********************************************************/

/**
 * Class for representing an account.
 *
 * These properties are provided, all of which are read-only:
 * - db: link back to the database
 * - data: the raw data for this Account (as in model.proto)
 * - parent: the parent account, or null if this is at the top level.
 * - children: an array of children, which may be empty.
 *
 * Subscribing to an account through the observable interface only notifies you
 * about changes in the Account * *definition* (like its name, parent, children,
 * type).
 *
 * Subscribing to an account does *not* notify you about any transaction or
 * balance data about the account.  For that, create a Reader and subscribe
 * to it.
 *
 * @constructor
 */
export class Account extends Observable {
  constructor(db, data) {
    super();

    this.db = db;
    this.data = data;
    this.parent = null;
    this.children = new SortedMap();
    this.readers = new Set();

    if (!Account.isValid(data)) {
      throw "invalid account";
    }

    if (data.guid) {
      if (this.db.getAccountByGuid(data.guid)) {
        throw "Tried to duplicate existing account";
      }
    } else {
      data.guid = guid();
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

  /**
   * Returns true if the given account is valid in isolation.
   * Does not validate things external to this account, like that the parent
   * account must exist.
   */
  static isValid(accountData) {
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
  update(newData) {
    if (!Account.isValid(newData)) {
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
  delete() {
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
   *   [Date, Balance]
   *
   * Options (and their defaults) are: {
   *   // How many sample points should be part of the sequence.
   *   "count": 1,
   *
   *   // When the last point should be.
   *   "end": new Date(),  // ie. default is now.
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
  newBalanceReader(options) {
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
    return new Reader(this, opts);
  }

  /**
   * Returns a new Reader that vends a sequence of Transactions for this
   * account.  The iterated items are: Transaction objects.
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
  newTransactionReader(options) {
    var defaults = {
      type: "transaction",
      count: 20,
      end: new Date(),
      includeChildren: true
    }

    var opts = merge(options, defaults);
    return new Reader(this, opts);
  }

  /**
   * Internal-only method called when a reader gains at least one subscriber.
   * The Reader is linked to the Account when it is created, but the Account
   * only tracks and updates it when it has at least one subscriber.
   */
  _addReader(reader) {
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
          new Balance(this.data.commodity_guid) : new Decimal();

      for (let [key, txn] of this.db.transactionsByTime.iterator()) {
        var info = txn.getAccountInfo(this.data.guid);

        if (info) {
          var amount = opts.includeChildren ? info.totalAmount : info.amount;
          balance.add(amount);
        }
      }

      reader.values = [balance];
    } else if (opts.type == "transaction") {
      reader.values = [];
      for (let [key, txn] of this.db.transactionsByTime.riterator()) {
        reader.values.push(txn);
      }
      reader.values.reverse()
    } else {
      throw "Unknown reader type: " + opts.type;
    }
  }

  /**
   * Internal-only method called when a reader loses its last subscriber.
   * When this happens the Account will stop tracking and updating this reader.
   */
  _removeReader(reader) {
    this.readers.delete(reader);
  }

  /**
   * Internal-only method called when a transaction for this account changes.
   */
  _onTransactionChange(txn) {
    for (let reader of this.readers) {
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
      } else {
        throw "Unknown reader type: " + opts.type;
      }

      reader._notifyChange();
    }
  }
}

/** Transaction *******************************************************/

/**
 * Transaction: object representing a transaction in the database.
 *
 * Contains these properties:
 * - db: link back to the database
 * - data: the raw data for this Transaction (as in model.proto)
 */
export class Transaction extends Observable {
  constructor(db, txnData) {
    super()

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
      txnData.guid = guid();
    }

    Object.freeze(txnData);

    this.db.transactionsByGuid.set(txnData.guid, this);
    this.db.transactionsByTime.add(this._byTimeKey(), this);
    this.accountInfo = new Map();
    this._updateAccountInfo();
  }

  /**
   * Returns true if the given transaction is valid in isolation.
   *
   * Does not validate things external to this transaction, like that all of the
   * accounts must exist.
   *
   * We also can't validate that the amounts balance here, because we don't know
   * the currency/commodity of the referenced accounts.
   */
  static isValid(txnData) {
    if (typeof txnData.timestamp != "number" ||
        typeof txnData.description != "string" ||
        !isArray(txnData.entry) ||
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
   *  - amount: Decimal: amount for this txn for this specific account.
   *  - totalAmount: Balance: amount for this txn in this and all
   *    sub-accounts.
   */
  getAccountInfo(accountGuid) {
    return this.accountInfo.get(accountGuid);
  }

  /**
   * Returns the previous account info for this account, or null if not.
   */
  getOldAccountInfo(accountGuid) {
    return this.oldAccountInfo.get(accountGuid);
  }

  /**
   * Updates an existing transaction.  Transaction guid must be set, and the
   * transaction must be valid.  This will completely overwrite the previous
   * value of this transaction.
   *
   * @param {Transaction} transaction The new value for this transaction.
   */
  update(newData) {
    if (!this.db.transactionIsValid(newData)) {
      throw "invalid transaction";
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

    var reinsert = false;

    if (newData.timestamp != this.data.timestamp) {
      this.db.transactionsByTime.delete(this._byTimeKey());
      reinsert = true;
    }

    Object.freeze(newData);
    this.data = newData;

    if (reinsert) {
      this.db.transactionsByTime.add(this._byTimeKey(), this);
    }

    this._updateAccountInfo();
  }

  /**
   * Deletes an existing transaction.
   *
   * @param {string} transactionGuid The guid of the transaction to delete.
   */
  delete() {
    this.db.transactionsByTime.delete(this._byTimeKey());
    this.db.transactionsByGuid.delete(this.data.guid);

    // Not actually valid data, but will help zero out our effect on time series
    // objects.
    this.data = {
      entry: []
    };

    this._updateAccountInfo();
  }

  /**
   * Internal-only method that should be called whenever the transaction data
   * changes, which will update the internal data that is derived from the raw
   * transaction data.
   *
   * Also triggers notifications to anyone watching the transaction, and to any
   * register or time series objects that depend on this data.
   */
  _updateAccountInfo() {
    // Create new accountInfo for all accounts in the transaction (and their
    // parents).
    this.oldAccountInfo = this.accountInfo;
    this.accountInfo = new Map();

    var affectedAccounts = new Set();
    for (let guid of this.oldAccountInfo.keys()) {
      affectedAccounts.add(guid);
    }

    for (var i in this.data.entry) {
      var entry = this.data.entry[i];
      var entryAccount = this.db.getAccountByGuid(entry.account_guid);
      var entryAccountIsLeaf = (entryAccount.children.size == 0);
      var account = entryAccount;

      do {
        var guid = account.data.guid;
        var info = this.accountInfo.get(guid)
        var isEntryAccount = (account == entryAccount);

        affectedAccounts.add(guid);

        if (!info) {
          info = {
            description: this.data.description,
            date: this.date,
            amount: new Decimal(),
            totalAmount: new Balance()
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
            new Balance(account.data.commodity_guid, entry.amount);
        info.totalAmount.add(amountBalance);
        info.amount.add(new Decimal(entry.amount));
      } while ((account = account.parent) != null);
    }

    // Triggers updates (and notifications) to any time series or transaction
    // reader objects.
    for (let guid of affectedAccounts.values()) {
      this.db.getAccountByGuid(guid)._onTransactionChange(this);
    }

    // Triggers notifications to any objects watching the transaction itself.
    this._notifyChange();
  }

  /**
   * Internal only method to calculate the key for this transaction in the sorted
   * map.
   */
  _byTimeKey() {
    return this.data.timestamp.toString() + this.data.guid;
  }
}


/** Reader ************************************************************/

/**
 * A Reader is an iterable object that is kept up-to-date whenever the DB
 * changes.
 *
 * For example, if you get a transaction Reader, you can iterate over it as
 * many times as you want and it will always return the up-to-date values for
 * all transactions in the domain.
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
class Reader extends Observable {
  constructor(account, options, calculate) {
    super();
    this.account = account;
    this.options = options;
  }

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
  iterator() {
    return new ReaderIterator(this.values);
  }

  _notifyHasSubscribers() {
    this.account._addReader(this);
  }

  _notifyNoSubscribers() {
    this.account._removeReader(this);
  }
}


/** ReaderIterator ****************************************************/

class ReaderIterator {
  constructor(values) {
    this.values = values;
    this.pos = 0;
  }

  [Symbol.iterator]() {
    return this;
  }

  next() {
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
}
