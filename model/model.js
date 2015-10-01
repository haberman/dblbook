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

  nodes.forEach((node) => { byGuid[node.guid] = node });

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
 * For now we don't support mixed precision (ie. "10.1" + "10.23") because we
 * assume that all amounts for a given currency will use the precision of that
 * currency.  We can revisit this later if required.
 */
class Decimal {
  /**
   * Constructs a Decimal instance from decimal string.
   *
   * @param {String} value The decimal string (ie. "123.45").  The number of
   *   significant digits is noted, so "123.45" is different than "123.450".
   */
  constructor(value) {
    let isNegative = false;

    if (value.charAt(0) == "-") {
      isNegative = true;
      value = value.slice(1);
    }

    let firstDecimal = value.indexOf(".");

    if (firstDecimal != value.lastIndexOf(".")) {
      throw "Value had more than one decimal point";
    }

    if (firstDecimal == -1) {
      this.precision = 0;
    } else {
      this.precision = value.length - firstDecimal - 1;
    }

    this.value = parseInt(value.replace(/\./, ''));

    if (isNegative) { this.value = -this.value; }
  }

  /**
   * Adds the given Decimal to this one.  They must have the same precision.
   * @param {Decimal} other The number to add to this one.
   */
  add(other) {
    if (this.precision != other.precision) {
      throw "Precisions must be the same."
    }
    this.value += other.value;
  }

  /**
   * Subtracts the given Decimal from this one.
   * @param {Decimal} other The number to subtract from this one.
   */
  sub(other) {
    if (this.precision != other.precision) {
      throw "Precisions must be the same."
    }
    this.value -= other.value;
  }

  /**
   * Returns true iff the value is zero.
   */
  isZero() {
    return this.value == 0;
  }

  /**
   * Returns a new value that has the value zero, but with this instance's
   * precision.
   */
  newZero() {
    let ret = new Decimal("0");
    ret.precision = this.precision;
    return ret;
  }

  /**
   * Converts the Decimal object to a string, retaining all significant digits.
   * @return {String} The string representation.
   */
  toString() {
    return (this.value / Math.pow(10, this.precision)).toFixed(this.precision);
  }
}

/** Amount ********************************************************************/

/**
 * Class for representing an amount of money in one or more currencies.
 * Contains a set of decimal balances and their associated commodities
 * (currencies).
 *
 * This can be directly converted to/from the Amount type in model.proto.
 */
export class Amount {
  /**
   * Constructs a new Amount.
   *
   * @param{Amount || null} amount The Amount (from Amount.proto) to construct
   *   from.
   */
  constructor(amount) {
    this.commodities = new Map();

    // This is a map that parallels this.commodities, but collapses all lots
    // into a single value that represents the entire currency.  Created lazily
    // on-demand.
    this.collapsed = undefined;

    if (amount) {
      for (let commodity of Object.keys(amount)) {
        this.commodities.set(commodity, new Decimal(amount[commodity]));
      }
    }
  }

  dup() {
    let ret = new Amount();
    for (let [commodity, value] of this.commodities.entries()) {
      ret.commodities.set(commodity, value);
    }

    // TODO: copy collapsed
    return ret;
  }

  /**
   * Returns a plan JavaScript object for storing this Amount that follows the
   * Amount schema in model.proto.
   */
  toModel() {
    let ret = {}
    for (let [commodity, decimal] of this.commodities) {
      ret[commodity] = decimal.toString();
    }
    return ret;
  }

  _apply(other, func) {
    for (let [commodity, value] of other.commodities.entries()) {
      if (!this.commodities.has(commodity)) {
        this.commodities.set(commodity, value.newZero());
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
   * Adds the given amount to this one.
   * @param {Amount} amount The balance to add.
   */
  add(other) {
    this._apply(other, Decimal.prototype.add);
  }

  /**
   * Subtracts the given amount from this one.
   * @param {Amount} amount The balance to subtract.
   */
  sub(other) {
    this._apply(other, Decimal.prototype.sub);
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

  isZero() {
    return this.commodities.size == 0;
  }

  static isValid(data) {
    for (let commodity of Object.keys(data)) {
      if (typeof commodity != "string" ||
          typeof data[commodity] != "string") {
        return false;
      }
    }
    return true;
  }
}


/** Period / SummingPeriod ****************************************************/

class Period {
  /**
   * Adds a period to the global list of available periods.
   * For use at startup time only.
   */
  static add(name, roundDown, dateNext) {
    let period = new Period()
    period.name = name;
    period.roundDown = roundDown;
    period.dateNext = dateNext;

    Period.periods[name] = period;
  }
}

Period.periods = {};

// Periods you can use when requesting Readers.
// "FOREVER" is a special kind of period that we don't define here.
Period.add(
  "YEAR",
  (d) => new Date(d.getFullYear(), 0),
  (d) => new Date(d.getFullYear() + 1, 0)
);

Period.add(
  "QUARTER",
  (d) => new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3),
  (d) => new Date(d.getFullYear(), Math.ceil(d.getMonth() / 3) * 3)
);

Period.add(
  "MONTH",
  (d) => new Date(d.getFullYear(), d.getMonth()),
  (d) => new Date(d.getFullYear(), d.getMonth() + 1)
);

Period.add(
  "WEEK",
  // Currently this always starts weeks on Sunday, could make this configurable.
  (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay()),
  (d) => new Date(d.getFullYear, d.getMonth(), d.getDate() + 7 - d.getDay())
);

Period.add("DAY",
  (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()),
  (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)
);


class SummingPeriod extends Period {
  /**
   * Adds a period to the global list of available summing periods.
   * For use at startup time only.
   */
  static add(name, aggregateKey, strLength, onBoundary) {
    let period = Period.periods[name];

    if (!period) {
      throw "Must have previously been declared as a period.";
    }

    let new_period = new SummingPeriod();

    new_period.name = period.name;
    new_period.roundDown = period.roundDown;
    new_period.dateNext = period.dateNext;

    new_period.aggregateKey = aggregateKey + ";";
    new_period.strLength = strLength;
    new_period.onBoundary = onBoundary;

    SummingPeriod.periods.push(new_period);
    Period.periods[period.name] = new_period;
  }

  stringToDate(string) {
    let d = new Date();
    d.setTime(Date.parse(string));
    return d;
  }

  /**
   * Gets a sum key for this date and period.  The date should be on a boundary
   * for this period.
   */
  getSumKey(date) {
    if (!this.onBoundary(date)) {
      throw "Not on proper boundary!";
    }

    return this.aggregateKey + date.toISOString().substr(0, this.strLength);
  }

  /**
   * Given a startDate and endDate that are on day boundaries, returns an
   * array of summing keys (in format "D;2015-05-05", for example) that cover
   * this entire range.  Returns the smallest number of strings possible (by
   * using the coarsest sums possible).
   */
  static getSumKeysForRange(startDate, endDate) {
    if (!SummingPeriod.onDayBoundary(startDate) ||
        !SummingPeriod.onDayBoundary(endDate)) {
      throw "Sums only have day granularity, both start and end date must be " +
          "on day boundaries.";
    }

    let sum_keys = [];
    let date = new Date(startDate.getTime());

    while (date < endDate) {
      let i;

      // Iterate over the periods from coarsest to finest, so that we create the
      // shortest list of sum keys possible.
      for (i = 0; i < SummingPeriod.periods.length; i++) {
        let period = SummingPeriod.periods[i];
        let nextDate = period.dateNext(date);
        if (period.onBoundary(date) && nextDate <= endDate) {
          sum_keys.push(period.getSumKey(date));
          date = nextDate;
          break;
        }
      }

      if (i == SummingPeriod.periods.length) {
        throw "Not on a day boundary somehow?";
      }

    }

    return sum_keys;
  }

  static onDayBoundary(date) {
    return date.getHours() == 0 && date.getMinutes() == 0 &&
        date.getSeconds() == 0 && date.getMilliseconds() == 0;
  }

  static onMonthBoundary(date) {
    return SummingPeriod.onDayBoundary(date) && date.getDate() == 1;
  }

  static onYearBoundary(date) {
    return SummingPeriod.onMonthBoundary(date) && date.getMonth() == 0;
  }
}

SummingPeriod.periods = [];

// Periods we internally aggregate by (must also be defined above).
// Order is significant: must be listed biggest to smallest.
SummingPeriod.add("YEAR",  "Y",  4, SummingPeriod.onYearBoundary);
SummingPeriod.add("MONTH", "M",  7, SummingPeriod.onMonthBoundary);
SummingPeriod.add("DAY",   "D", 10, SummingPeriod.onDayBoundary);


/** Observable ********************************************************/

/**
 * Observable interface / base class.
 *
 * Objects that inherit from this (Account, Transaction, and Reader) allow you
 * to receive notification when the object changes.
 */
export class Observable {
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
    this.subscribers.set(subscriber, callback);
  }

  /**
   * Unregisters any previously registered callback for this subscriber.
   */
  unsubscribe(subscriber) { this.subscribers.delete(subscriber); }

  /**
   * Internal-only function for calling all subscribers that the object has
   * changed.
   */
  _notifySubscribers() {
    // Important: must gather the callbacks into an array first, because
    // delivering the notification can call back into unsubscribe().
    var callbacks = arrayFrom(this.subscribers.values());
    for (var i in callbacks) {
      callbacks[i]();
    }
  }

  /**
   * Takes an array of any number of observables and calls the given function
   * when all of them have loaded.  In the status quo everything is kept loaded
   * so the function is called immediately.
   */
  static whenLoaded(observables, func) { func(); }
}


/** DB ************************************************************************/

// Maps object store name to its key field name.
let ObjectStores = {
  "transactions": "guid",
  "accounts": "guid",
  "sums": "key"
};

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
 */
export class DB {
  /**
   * Constructor is not public: clients should obtain new DB instances with
   * DB.open() below.
   * @private
   */
  constructor() {
    this.readers = new Set();
    this.accountsByGuid = new Map();

    // Key is [decimal usec][guid].
    this.transactionsByTime = new SortedMap();
    this.transactionsByGuid = new Map();

    // Key is defined by sum.key().
    this.sumsByKey = new SortedMap();

    this.atomicLevel = 0;
    this.dirtyMap = new Map();
    this.committing = 0;
    this.version = 0;

    // Add the two root accounts -- these are currently special-cased and
    // not actually stored in the DB (should probably fix this).
    new Account(this, {
      "name": "Real Root Account (internal)",
      "guid": "REAL_ROOT",
      "type": "ASSET",
      "commodity_guid": "USD"
    }, true);

    new Account(this, {
      "name": "Nominal Root Account (internal)",
      "guid": "NOMINAL_ROOT",
      "type": "INCOME",
      "commodity_guid": "USD"
    }, true);
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
          store.createIndex("time_order", "date")

          store = idb.createObjectStore("accounts", {keyPath: "guid"});
          store = idb.createObjectStore("sums", {keyPath: "key"});
          initialized = true;
        }

        request.onblocked = function(e) {
          alert("Oops!");
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

            for (let account of accounts) { new Account(db, account, true); }

            resolve();
          }
        }
      });
    }

    let loadSums = function() {
      return new Promise(function(resolve, reject) {
        // Load accounts.

        let txn = db.idb.transaction("sums", "readonly");

        txn.objectStore("sums").openCursor().onsuccess = function(event) {
          let cursor = event.target.result;
          if (cursor) {
            let sum = cursor.value;
            db.sumsByKey.set(sum.key, new Sum(db, sum.key, sum));
            cursor.continue();
          } else {
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
            new Transaction(db, cursor.value, true);
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
        .then(loadSums)
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
   * Deletes the database (all data is completely lost!), returning a promise.
   */
  static delete() {
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

    for (var i in txnData.entry) {
      var entry = txnData.entry[i]
      if (!this.accountsByGuid.has(entry.account_guid)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Add this object to the set of "dirty" objects.  This means it has undergone
   * a state change and needs to be committed to the database.
   *
   * The state changes will not be flushed to the database until
   * db._checkpoint() is called, and then all dirty objects will be committed in
   * a single transaction.  This lets us ensure that all related updates are
   * committed atomically.
   */
  _addDirty(obj, collection) {
    console.log("Add dirty");
    let collectionSet = this.dirtyMap.get(collection);

    if (!collectionSet) {
    console.log("Add dirty 2");
      collectionSet = new Set();
      this.dirtyMap.set(collection, collectionSet);
    }

    collectionSet.add(obj);
    console.log("Add dirty 3");
    if (this.atomicLevel == 0) {
    console.log("Add dirty 4");
      this._commit();
    }
  }

  _commit() {
    if (this.dirtyMap.size == 0) {
      console.log("WEIRD!");
      return;
    }

    let txn = this.idb.transaction(arrayFrom(this.dirtyMap.keys()), "readwrite");
    let added = [];
    this.version++;

    for (let [collection, objSet] of this.dirtyMap) {
      let objectStore = txn.objectStore(collection);
      console.log("Flush dirty collection: ", collection);

      for (let obj of objSet) {
        console.log("Flush dirty obj: ", obj);
        obj._addToTransaction(objectStore, this.version);
        added.push(obj);
      }
    }

    this.committing++;
    this.dirtyMap.clear();

    // Even though the results aren't committed yet, we update our Readers to
    // reflect the changes.  If the UI wants to know whether the writes have
    // been written to the DB, it can check db.committing == 0.  We could
    // also potentially return a promise from atomic() that gives a signal for
    // when the transaction was committed.
    //
    // OPT: if we wanted to we would optimize this to only refresh readers that
    // actually changed.  But we generally expect there to be a relatively small
    // number of readers, and we expect refreshing them from in-memory data
    // to be very cheap.
    for (let reader of this.readers) {
      reader._refresh();
    }

    txn.oncomplete = () => {
      --this.committing;
      if (this.dirtyMap.size != 0 && this.atomicLevel == 0) {
        this._commit();
      }
    }

    txn.onerror = function(event) {
      console.log("Write transaction failed: ", event);
      alert("Write transaction failed (see console)");
      // Throw a very difficult-to-catch exception.
      setTimeout(function(){
          throw "Write transaction failed, cannot continue.";
      });
    }
  }

  static _getDbKey(data, collection) {
    let key = ObjectStores[collection];
    if (!key) {
      throw "Unknown collection name";
    }
    return data[key];
  }

  /**
   * Runs the given function, ensuring that any data mutations that happen
   * inside it are committed to the database atomically.  (Normally this
   * function might be called DB.transaction(), but we avoid that terminology
   * here to avoid confusion with accounting Transaction objects).
   *
   * Batching multiple related mutations into an atomic DB transaction is
   * important from a correctness point of view, but it also helps efficiency.
   * We don't push any of the mutations/updates to Reader objects until the
   * atomic block is done, so this can help prevent a torrent of notifications
   * when a bunch of related mutations are all being made at the same time.
   *
   * For this reasons, it pays to wrap a batch of mutations in DB.atomic().
   * DB.atomic() is safe to nest.
   */
  atomic(func) {
    this.atomicLevel++;
    func();
    if (--this.atomicLevel == 0) {
      this._commit();
    }
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
  createAccount(accountData) { return new Account(this, accountData); }

  /**
   * Adds a transaction.  The transaction must be valid.  The guid should not
   * be set.
   *
   * @param txnData The transaction to add.
   */
  createTransaction(txnData) { return new Transaction(this, txnData); }

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
   * Gets an account by guid, or undefined if no account has this guid.
   *
   * Since all accounts are loaded at all times, the account is returned
   * directly (not a promise).
   */
  getAccountByGuid(guid) {
    return this.accountsByGuid.get(guid);
  }

  /**
   * Gets a transaction by guid.  Returns a promise, since the transaction may
   * need to be loaded first.  If the transaction exists, the promise succeeds
   * and yields the transaction, otherwise the promise fails.
   */
  getTransactionByGuid(guid) {
    return new Promise(function(resolve, reject) {
      let cached = this.transactionsByGuid[guid];
      if (cached) {
        resolve(cached);
      } else {
        var dbTxn = db.idb.transaction("transactions", "readonly");

        request = dbTxn.objectStore("transactions").get(guid);
        request.onsuccess = function(event) {
          resolve(new Transaction(db, event.target.result, true));
        }
        request.onfailure = function(event) {
          console.log("Error loading transaction", event);
          reject(new Error("Error loading transaction", event));
        }
      }
    });
  }

  _getSumByKey(account, periodKey) {
    let key = account.data.guid + ";" + periodKey;
    if (this.sumsByKey.has(key)) {
      return this.sumsByKey.get(key);
    } else {
      let ret = new Sum(this, key)
      this.sumsByKey.set(key, ret);
      return ret;
    }
  }

  _getSum(account, date, period) {
    return this._getSumByKey(account, period.getSumKey(period.roundDown(date)));
  }

  _getSumsForAccountPeriod(account, startDate, endDate) {
    return SummingPeriod.getSumKeysForRange(startDate, endDate).map(
      (key) => this._getSumByKey(account, key)
    );
  }
}

/** DbUpdater *****************************************************************/

let ObjectStates = {
  ADD_PENDING: 0,
  UPDATE_PENDING: 1,
  COMMITTED: 2,
  DELETE_PENDING: 3,
  DELETED: 4
};

/**
 * Internal class used by DB-backed objects (Account, Transaction, Sum) to flush
 * changes to the DB.
 */
class DbUpdater {
  constructor(db, collection, obj, existsInDb) {
    this.db = db;
    this.collection = collection;
    this.obj = obj;
    this.obj.version = 0;
    this.state = existsInDb ? ObjectStates.COMMITTED : ObjectStates.ADD_PENDING;

    // This isn't used to actually perform the write, since the DB infers it.
    // But we use it to assert that update() calls don't change the key.
    this.key = DB._getDbKey(obj.toModel(), collection);

    if (!existsInDb) {
      this.db._addDirty(this, this.collection);
    }
  }

  /**
   * Called by the DB when a transaction is being populated with updates.
   * This object should add its updates to objectStore (which will be for the
   * collection specified in this.collection).
   */
  _addToTransaction(objectStore, version) {
    let data = this.obj.toModel();
    if (data[objectStore.keyPath] != this.key) {
      throw "Update should not change key.";
    }

    switch (this.state) {
      case ObjectStates.ADD_PENDING:
        // Use put() to make sure the write fails if the key already exists.
        objectStore.add(data);
        break;
      case ObjectStates.UPDATE_PENDING:
        // OPT: we could potentially avoid this write if we can somehow tell
        // that the underlying database already has this value.  This is most
        // likely to be useful for sums, which could very likely have a value
        // subtracted and then added again, making the overall operation a
        // no-op.
        objectStore.put(data);
        break;
      case ObjectStates.DELETE_PENDING:
        objectStore.delete(data[objectStore.keyPath]);
        break;
      default:
        throw "Unexpected state: " + this.state;
    }

    if (this.state == ObjectStates.DELETE_PENDING) {
      console.log("DbUpdater addToTransaction -> DELETED", this.obj);
      this.state = ObjectStates.DELETED;
    } else {
      console.log("DbUpdater addToTransaction -> COMMITTED", this.obj);
      this.state = ObjectStates.COMMITTED;
    }

    this.obj.version = version;
  }

  checkOkToUpdate() {
    if (this.isDeleted()) {
      throw "Can't update a deleted object!";
    }
  }

  /**
   * Call to indicate that this object should be upated in the DB.
   * The object's toModel() function will be called to obtain the actual data.
   */
  update() {
    console.log("DbUpdater update", this.obj);
    this.checkOkToUpdate();

    if (true) {
      let key = DB._getDbKey(this.obj.toModel(), this.collection);

      if (key != this.key) {
        console.log("Old key: ", this.lastKey, "New key: ", key);
        throw "Update should not change key!";
      }
    }

    console.log("DbUpdater update 2", this.state, this.obj);
    if (this.state == ObjectStates.COMMITTED) {
      console.log("DbUpdater update COMMITTED -> UPDATE_PENDING", this.obj);
      this.state = ObjectStates.UPDATE_PENDING;
      this.db._addDirty(this, this.collection);
    }
  }

  checkOkToDelete() {
    if (this.isDeleted()) {
      throw "Object is already deleted, can't delete it twice.";
    }
  }

  delete() {
    this.checkOkToDelete();

    if (this.state == ObjectStates.COMMITTED) {
      this.db._addDirty(this, this.collection);
    }

    this.state = ObjectStates.DELETE_PENDING;
  }

  isDeleted() {
    return this.state == ObjectStates.DELETE_PENDING ||
        this.state == ObjectStates.DELETED;
  }
}


/** Account *******************************************************************/

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
 */
export class Account extends Observable {
  /**
   * Constructor is not public: clients should create new accounts with
   * db.createAccount().  This constructor is for use of the DB only.
   * @private
   */
  constructor(db, data, existsInDb) {
    super();

    this.db = db;
    this.data = data;
    this.parent = null;
    this.children = new SortedMap();

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
      this.parent._notifySubscribers();
    }

    this.dbUpdater = new DbUpdater(db, "accounts", this, existsInDb);
  }

  toModel() { return this.data; }

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
    this.dbUpdater.checkOkToUpdate();

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

      oldParent._notifySubscribers();
      newParent._notifySubscribers();

      this.parent = newParent;

      // TODO(haberman) update sums.
    }

    Object.freeze(newData);

    this.data = newData;
    this.dbUpdater.update();
  }

  /**
   * Deletes an existing account.
   * The account must not have any transactions that reference it.
   */
  delete() {
    this.dbUpdater.checkOkToDelete();

    // TODO: What is the right way to test this?
    //if (this.last) {
    //  throw "cannot delete account with any transactions";
    //}

    if (this.parent) {
      this.parent.children.delete(this.data.name);
      this.parent._notifySubscribers();
      // TODO:
      // Should we notify the account itself?
      // Then any view that depends on it could just
      // redirect somewhere else?
    }

    this.db.accountsByGuid.delete(this.data.guid);
    this.dbUpdater.delete()
  }

  /**
   * Returns a promise for a new Reader that vends balance/delta information
   * for a series of equally-spaced time windows (for example, every day for
   * seven days).
   *
   * Each iterated item is an object containing the members:
   *
   * {
   *   // Represents the beginning and end of the period.
   *   // The end date is 1ms before the beginning of the next start date.
   *   start_date: Date(),
   *   end_date: Date(),
   *
   *   // The overall balance for this account at the start/end of the period.
   *   start_balance: Amount(),
   *   end_balance: Amount(),
   *
   *   // The change in balance over this period (end_balance - start_balance).
   *   delta: Amount()
   * }
   *
   * Options (and their defaults) are: {
   *   // How many time windows should be part of the sequence.
   *   "count": 1,
   *
   *   // Specify either start_date OR end_date (but not both).
   *   // The first (or last) period of the series will include this date.
   *   "start_date": new Date(),
   *   "end_date": new Date(),
   *
   *   // TODO: add an "exclude future transactions" flag?
   *   // That would let users get an "year-to-date" value (for example) without
   *   // including future (ie. speculative) transactions.
   *
   *   // Frequency of points.
   *   // Valid values are: "DAY", "WEEK", "MONTH", "QUARTER", "YEAR", "FOREVER".
   *   // "FOREVER" is only valid when count = 1.
   *   "frequency": "FOREVER",
   * }
   */
  newBalanceReader(options) { return new BalanceReader(this, options); }

  /**
   * Returns a new EntryReader that vends a sequence of Entry objects for this
   * account.  Each iterated item is a pair of:
   *
   *   [Entry, Amount]
   *
   * Where the Amount is the overall balance of this account.
   *
   * TODO: figure out options.
   *
   * - start/end/count and what combination should be supported?
   * - do we need to support both date orders or just one?
   *
   * Options (and their defaults) are: {
   *   // How many transactions should be part of the sequence.
   *   "count": 20,
   *
   *   // The first returned transaction will be the one directly at or before
   *   // this date.
   *   "end": new Date(),
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
  newEntryReader(options) {
    var defaults = {
      type: "transaction",
      count: 20,
      end: new Date(),
      includeChildren: true
    }

    var opts = merge(options, defaults);
    return new EntryReader(this, opts);
  }

}

/** Sum ***********************************************************************/

/**
 * Class that represents the sum of all entry amounts for a particular account
 * (and its children) over a window of time.
 *
 * This class is internal-only.
 */
class Sum {
  constructor(db, key, data) {
    this.db = db;
    this.key = key;

    if (data) {
      if (data.key != this.key) {
        throw "Keys didn't match.";
      }
      this.amount = new Amount(data.amount);
      this.count = data.count;
    } else {
      this.amount = new Amount();
      this.count = 0;
    }

    // Since a new sum always starts at 0, which doesn't require an explicit
    // write to the DB, we always start by assuming that our initial state
    // is what also exists in the db.
    this.dbUpdater = new DbUpdater(db, "sums", this, true);
  }

  /**
   * Adds an entry to our sums.
   */
  add(entry) {
    this.amount.add(entry.amount);
    this.count += 1;
    this.dbUpdater.update();
  }

  /**
   * Subtracts an entry to our sums.
   */
  sub(entry) {
    this.amount.sub(entry.amount);
    this.count -= 1;
    this.dbUpdater.update();
  }

  toModel() {
    return {
      key: this.key,
      count: this.count,
      amount: this.amount.toModel()
    };
  }
}

/** Entry *********************************************************************/

/**
 * Class that represents a single entry of a transaction.  Every Transaction has
 * two or more of these.  An Entry represents the effects of a transaction on a
 * single account.
 *
 * Entry does *not* provide the current balance of the account.  For that, use
 * db.newEntryReader(), which will provide Entry objects *along with* current
 * balance data.
 *
 * These Entry objects are not 1:1 with Transaction entries in the database.
 * We create extra Entry objects for parent accounts of the actual DB entry,
 * so we'll always create more Entry objects than the DB has.
 */
class Entry {
  /**
   * Constructor is not public: clients can create Transaction objects (with
   * entry data) which will internally create Entry objects.
   *
   * @private
   * @param {boolean} isNew Set to true if this is a new entry (not just loaded
   *                        from the database.  This will update the appropriate
   *                        sums.
   */
  constructor(txn, account, description) {
    this.txn = txn;
    this.account = account;
    this.description = description;
    this.amount = new Amount();
    this.sums = SummingPeriod.periods.map(
      (p) => txn.db._getSum(account, txn.date, p)
    );
  }

  /**
   * Adds to the current amount
   */
  _addAmount(amount) {
    this.amount.add(amount);
  }

  /**
   * Adds our amount to our sums.
   */
  _addToSums() {
    for (let sum of this.sums) { sum.add(this); }
  }

  /**
   * Subtracts our amount from our sums.
   */
  _subtractFromSums() {
    for (let sum of this.sums) { sum.sub(this); }
  }

  /**
   * @return {Amount} The amount for this entry.
   */
  getAmount() { return this.amount; }

  /**
   * @return {string} The description (either from the Entry or the
   *                  Transaction).
   */
  getDescription() {
    return this.entryData.description || this.txn.data.description;
  }
}

/** Transaction ***************************************************************/

/**
 * Transaction: object representing a transaction in the database.
 *
 * Contains these properties:
 * - db: link back to the database
 * - data: the raw data for this Transaction (as in model.proto)
 */
export class Transaction extends Observable {
  /**
   * Constructor is not public: clients should create new transactions with
   * db.createTransaction().  This constructor is for use of the DB only.
   * @private
   */
  constructor(db, txnData, existsInDb) {
    super()

    this.db = db;
    this.data = txnData;
    this.date = new Date(txnData.date);
    this.existsInDb = existsInDb;

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

    this.db.atomic(() => {
      this._createEntries(!existsInDb);
      this.dbUpdater = new DbUpdater(db, "transactions", this, existsInDb);
    });
  }

  toModel() { return this.data; }

  /**
   * If the transaction is unbalanced, returns the unbalanced balance.
   * Otherwise, (if the transaction is balanced), returns null.
   */
  static unbalancedAmount(txnData) {
    var unbalanced = new Amount();

    for (var i in txnData.entry) {
      unbalanced.add(new Amount(txnData.entry[i].amount));
    }

    if (unbalanced.isZero()) {
      return null;
    } else {
      return unbalanced;
    }
  }


  _createEntries(add) {
    this.entries = new Map();

    for (let i in this.data.entry) {
      let entryData = this.data.entry[i];
      let account = this.db.accountsByGuid.get(entryData.account_guid);

      // We create Entry objects for every parent account.
      // ie. even if the entry data in the txn only *explicitly* specifies
      // a change to a leaf account, we create an Entry for every parent
      // account up to the root.  And we update these all appropriately.
      do {
        let entry = this.entries.get(account)

        if (!entry) {
          entry = new Entry(this, account, entryData);
          this.entries.set(account, entry);
        }

        entry._addAmount(new Amount(entryData.amount));
      } while ((account = account.parent) != null);

    }

    if (add) {
      for (let entry of this.entries.values()) {
        entry._addToSums();
      }
    }
  }

  _subtractEntries() {
    for (let entry of this.entries.values()) {
      entry._subtractFromSums();
    }
  }

  /**
   * Returns true if the given transaction is valid in isolation.
   *
   * Does not validate things external to this transaction, like that all of the
   * accounts must exist.
   */
  static isValid(txnData) {
    if (typeof txnData.date != "string" ||
        typeof txnData.description != "string" ||
        !isArray(txnData.entry) ||
        txnData.entry.length < 2) {
      return false;
    }

    if (Transaction.unbalancedAmount(txnData)) {
      return false;
    }

    for (var i in txnData.entry) {
      var entry = txnData.entry[i]
      if (typeof entry.account_guid != "string" ||
          entry.account_guid == "REAL_ROOT" ||
          entry.account_guid == "NOMINAL_ROOT" ||
          !Amount.isValid(entry.amount)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Updates an existing transaction.  Transaction guid must be set, and the
   * transaction must be valid.  This will completely overwrite the previous
   * value of this transaction.
   */
  update(newData) {
    console.log("Transaction update");
    this.dbUpdater.checkOkToUpdate();

    if (!this.db.transactionIsValid(newData)) {
      throw "invalid transaction";
    }

    if (newData.guid) {
      if (newData.guid != this.data.guid) {
        throw "Cannot change transaction GUID.";
      }
    } else {
      // Specifying GUID in new data is not necessary.
      // TODO: should we extend this to all properties; ie. automatically merge
      // and remove properties with {property: null}?
      newData.guid = this.data.guid;
    }

    let oldDate = this.data.date;
    let oldByTimeKey = this._byTimeKey();

    // Validation complete, commit change.

    Object.freeze(newData);
    this.data = newData;

    this.db.atomic(() => {
      if (oldDate != newData.date) {
        this.db.transactionsByTime.delete(oldByTimeKey);
        this.db.transactionsByTime.add(this._byTimeKey(), this);
      }

      this._subtractEntries();
      this._createEntries(true);
      this.dbUpdater.update();
    });
  }

  /**
   * Deletes this transaction.
   */
  delete() {
    this.dbUpdater.checkOkToDelete();

    this.db.transactionsByTime.delete(this._byTimeKey());
    this.db.transactionsByGuid.delete(this.data.guid);

    this.db.atomic(() => {
      this._subtractEntries();
      this.dbUpdater.delete();
    });
  }

  /**
   * Internal only method to calculate the key for this transaction in the sorted
   * map.
   */
  _byTimeKey() {
    return this.data.date + this.data.guid;
  }
}

/** BalanceReader *************************************************************/

let Periods = new Set(["DAY", "WEEK", "MONTH", "QUARTER", "YEAR", "FOREVER"]);

// These limits shouldn't be too wide until we have smarter logic about tracking
// min/max transaction per account.
let DateLimits = {
  MIN_DATE: new Date("2000/01/01"),
  MAX_DATE: new Date("2020/01/01"),
};

class BalanceReader extends Observable {
  constructor(account, options) {
    super();

    if (!Periods.has(options.period)) {
      throw "Unknown period: " + options.period;
    }

    // Instead of these rules, we could implement a 2-of-3 for start_date,
    // end_date, count.
    if (options.period == "FOREVER") {
      if (options.count && options.count != 1) {
        throw "FOREVER period requires count == 1 (or omit it)";
      }
    }

    this.db = account.db;
    this.db.readers.add(this);

    this.periods = [];
    this.version = 0;

    if (options.period == "FOREVER") {
      if (options.count && options.count != 1) {
        throw "FOREVER period requires count == 1 (or omit it)";
      }
      this.periods.push({
        start_date: DateLimits.MIN_DATE,
        end_date: DateLimits.MAX_DATE,
      });
    } else {
      let step, date;

      if (options.start_date) {
        if (options.end_date) {
          throw "Specifying both start and end date isn't supported yet.";
        }
        date = options.start_date;
        step = 1;
      } else {
        if (!options.end_date) {
          throw "Must specify one of start_date, end_date";
        }
        date = options.end_date;
        step = -1;
      }

      if (!options.count) {
        throw "Must specify count (for now).";
      }

      this._pushPeriod(date);

      if (options.period == "DAY") {
        for (let i = 1; i < options.count; i++) {
          date.setDate(date.getDate() + step);
          this._pushPeriod(date, options.period);
        }
      } else if (options.period == "WEEK") {
        for (let i = 1; i < options.count; i++) {
          date.setDate(date.getDate() + (step * 14));
          this._pushPeriod(date, options.period);
        }
      } else if (options.period == "MONTH") {
        for (let i = 1; i < options.count; i++) {
          date.setMonth(date.getMonth() + step);
          this._pushPeriod(date, options.period);
        }
      } else if (options.period == "QUARTER") {
        for (let i = 1; i < options.count; i++) {
          date.setMonth(date.getMonth() + (step * 3));
          this._pushPeriod(date, options.period);
        }
      } else if (options.period == "YEAR") {
        for (let i = 1; i < options.count; i++) {
          date.setYear(date.getFullYear() + step);
          this._pushPeriod(date, options.period);
        }
      }

      if (step == -1) {
        // So the points are in forwards chronological order.
        this.periods.reverse();
      }
    }

    for (let period of this.periods) {
      period._sums = this.db._getSumsForAccountPeriod(
          account, period.start_date, period.end_date);
    }

    this.initialSums = this.db._getSumsForAccountPeriod(
        account, DateLimits.MIN_DATE, this.periods[0].start_date);

    this._refresh();
  }

  _refresh() {
    // Re-compute the pre-computed sums.
    var maxVersion = 0;

    console.log("Reader refresh");
    let total = new Amount();
    for (let sum of this.initialSums) {
      maxVersion = Math.max(maxVersion, sum.version);
      total.add(sum.amount);
    }
    let last_end = total.dup();

    for (let period of this.periods) {
      let periodAmount = new Amount();
      for (let sum of period._sums) {
        maxVersion = Math.max(maxVersion, sum.version);
        periodAmount.add(sum.amount);
      }

      period.start_balance = last_end;
      period.end_balance = last_end.dup();
      period.end_balance.add(periodAmount);
      period.delta = periodAmount;

      last_end = period.end_balance;
    }

    if (maxVersion > this.version) {
      this._notifySubscribers();
      this.version = maxVersion;
    }
  }

  periods() {
    return this.periods;
  }

  release() {
    this.db.readers.delete(this);
  }
}
