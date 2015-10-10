/**
 * @fileoverview Core data types for amounts, balances, currencies, etc.
 * Inspired by Ledger (http://ledger-cli.org).
 * @author jhaberman@gmail.com (Josh Haberman)
 * @flow
 */

"use strict";

// $FlowIssue: how to allow this without processing all of node_modules/?
import { RBTree } from 'bintrees';

declare var indexedDB: any;

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
class SortedMapIterator<K, V> {
  rbIter: any;       // The underlying RBTree iterator.
  nextFunc: string;  // "next" or "prev" -- which function to call for the next item.
  done: boolean;     // Whether we have reached EOF.

  constructor(rbIter: any, nextFunc: string) {
    this.rbIter = rbIter;
    this.nextFunc = nextFunc;
    this.done = false;
  }

  // $FlowIssue: Computed property keys not supported.
  [Symbol.iterator]() { return this; }

  // $FlowIssue: It doesn't like what's going on here.
  next() {
    let item;
    if (this.done || (item = this.rbIter[this.nextFunc]()) == null) {
      this.done = true;
      return {
        done: true,
        value: null,
      };
    } else {
      return {
        value: item,
        done: false,
      };
    }
  }
}

/** dblbook.SortedMap *********************************************************/

/**
 * Sorted string -> value map.
 */
class SortedMap<K, V> {
  tree: RBTree;
  size: number;

  constructor() {
     this.tree = new RBTree(SortedMap._compare);

  // $FlowIssue: 'Property not found in object literal'
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
  add(key: K, val: V) {
    var ok = this.tree.insert([key, val]);
    if (!ok) {
      throw "Key was already present.";
    }
  }

  /**
   * Sets the given key/value pair in the map, overwriting any previous value
   * for "key".
   */
  set(key: K, val: V) {
    this.tree.remove([key, null]);
    this.tree.insert([key, val]);
  }

  /**
   * Removes the given key from the map, if present.
   * for "key".
   */
  delete(key: K) {
    this.tree.remove([key, null]);
  }

  /**
   * Returns true if the given key is in the map.
   */
  has(key: K): boolean {
    return this.tree.find([key, null]) != null;
  }

  /**
   * Returns the value for this key if it exists, otherwise null.
   */
  get(key: K): ?V {
    var val = this.tree.find([key, null]);
    return val ? val[1] : null;
  }

  /**
   * Returns an iterator over the map's entries, in key order.
   * If a key is provided, iteration starts at or immediately
   * after this key.
   */
  iterator(key: ?K): SortedMapIterator<K, V> {
    if (key) {
      return new SortedMapIterator(this.tree.lowerBound([key, null]), "next");
    } else {
      return new SortedMapIterator(this.tree.iterator(), "next");
    }
  }

  /**
   * Returns an iterator over the map's entries, in reverse key order.
   * If a key is provided, iteration starts immediately before this key.
   */
  riterator(key: ?K): SortedMapIterator<K, V> {
    if (key) {
      let iter = new SortedMapIterator(this.tree.iterator(), "prev");
      iter.next();  // Skip element after this key.
      return iter;
    } else {
      return new SortedMapIterator(this.tree.iterator(), "prev");
    }
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
  // The value is: value * 10^precision.
  value: number;
  precision: number;

  /**
   * Constructs a Decimal instance from decimal string.
   *
   * @param {String} value The decimal string (ie. "123.45").  The number of
   *   significant digits is noted, so "123.45" is different than "123.450".
   */
  constructor(value: string) {
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
  commodities: Map<string, Decimal>;

  // This is a map that parallels this.commodities, but collapses all lots
  // into a single value that represents the entire currency.  Created lazily
  // on-demand.
  collapsed: ?Map<string, Decimal>;

  /**
   * Constructs a new Amount.
   *
   * @param{Amount || null} amount The Amount (from Amount.proto) to construct
   *   from.
   */
  constructor(amount: ?Object) {
    this.commodities = new Map();
    this.collapsed = undefined;

    if (amount) {
      for (let commodity of Object.keys(amount)) {
        this.commodities.set(commodity, new Decimal(amount[commodity]));
      }
    }
  }

  dup(): Amount {
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
  toModel(): Object {
    let ret = {}
    for (let [commodity, decimal] of this.commodities) {
      ret[commodity] = decimal.toString();
    }
    return ret;
  }

  _apply(other: Amount, func: Function) {
    for (let [commodity, value] of other.commodities.entries()) {
      if (!this.commodities.has(commodity)) {
        this.commodities.set(commodity, value.newZero());
      }

      var amt1 = this.commodities.get(commodity);
      var amt2 = other.commodities.get(commodity);

      func.call(amt1, amt2);

      if (amt1.isZero()) {
        this.commodities.delete(commodity);
      }
    }
  }

  /**
   * Adds the given amount to this one.
   * @param {Amount} amount The balance to add.
   */
  add(other: Amount) {
    this._apply(other, Decimal.prototype.add);
  }

  /**
   * Subtracts the given amount from this one.
   * @param {Amount} amount The balance to subtract.
   */
  sub(other: Amount) {
    this._apply(other, Decimal.prototype.sub);
  }

  toString(): string {
    var strs = [];
    for (let [commodity, val] of this.commodities) {
      let valStr = val.toString();

      // Special-case commodities with common symbols.
      if (commodity == "USD") {
        let isNegative = false;
        if (valStr.substring(0, 1) == "-") {
          isNegative = true;
          valStr = valStr.substring(1);
        }
        valStr = "$" + valStr;
        if (isNegative) {
          valStr = "-" + valStr;
        }
        strs.push(valStr);
      } else {
        strs.push(valStr + " " + commodity);
      }
    }
    var ret = strs.join(", ");

    if (ret == "") {
      ret = "0";
    }

    return ret;
  }

  isZero(): boolean {
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
  name: string;
  roundDown: Function;
  dateNext: Function;

  static periods: Map<string, Period>;

  /**
   * Adds a period to the global list of available periods.
   * For use at startup time only.
   */
  static add(name, roundDown, dateNext) {
    let period = new Period()
    period.name = name;
    period.roundDown = roundDown;
    period.dateNext = dateNext;

    Period.periods.set(name, period);
  }
}

Period.periods = new Map();

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
  (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7 - d.getDay())
);

Period.add(
  "DAY",
  (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()),
  (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)
);


class SummingPeriod extends Period {
  aggregateKey: string;
  strLength: number;
  onBoundary: Function;

  // FLOW BUG: gets confused if we name this 'periods'.
  static periods2: Array<SummingPeriod>;

  /**
   * Adds a period to the global list of available summing periods.
   * For use at startup time only.
   */
  static add2(name, aggregateKey: string, strLength, onBoundary) {
    let period = Period.periods.get(name);

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

    SummingPeriod.periods2.push(new_period);
    Period.periods.set(period.name, new_period);
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
      for (i = 0; i < SummingPeriod.periods2.length; i++) {
        let period = SummingPeriod.periods2[i];
        let nextDate = period.dateNext(date);
        if (period.onBoundary(date) && nextDate <= endDate) {
          sum_keys.push(period.getSumKey(date));
          date = nextDate;
          break;
        }
      }

      if (i == SummingPeriod.periods2.length) {
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

SummingPeriod.periods2 = [];

// Periods we internally aggregate by (must also be defined above).
// Order is significant: must be listed biggest to smallest.
SummingPeriod.add2("YEAR",  "Y",  4, SummingPeriod.onYearBoundary);
//SummingPeriod.add2("MONTH", "M",  7, SummingPeriod.onMonthBoundary);
//SummingPeriod.add2("DAY",   "D", 10, SummingPeriod.onDayBoundary);


/** Observable ********************************************************/

/**
 * Observable interface / base class.
 *
 * Objects that inherit from this (Account, Transaction, and Reader) allow you
 * to receive notification when the object changes.
 */
export class Observable {
  // Keys are subscribed objects, values are associated callback functions.
  subscribers: Map<mixed, Function>;

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
  subscribe(subscriber: mixed, callback: Function) {
    this.subscribers.set(subscriber, callback);
  }

  /**
   * Unregisters any previously registered callback for this subscriber.
   */
  unsubscribe(subscriber: mixed) { this.subscribers.delete(subscriber); }

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
const ObjectStores = {
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
  idb: any;

  accountsByGuid:     Map<string, Account>;
  transactionsByGuid: Map<string, Transaction>;
  transactionsByTime: SortedMap<string, Transaction>;
  sumsByKey:          SortedMap<string, Sum>;

  readers: Set<Reader>;
  entryLists: Set<EntryList>;

  atomicLevel: number;
  dirtyMap: Map<string, Set<DbUpdater>>;
  committing: number;
  version: number;

  static singleton: DB;

  /**
   * Constructor is not public: clients should obtain new DB instances with
   * DB.open() below.
   * @private
   */
  constructor() {
    this.readers = new Set();
    this.entryLists = new Set();
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
    }, true);

    new Account(this, {
      "name": "Nominal Root Account (internal)",
      "guid": "NOMINAL_ROOT",
      "type": "INCOME",
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
            resolve(db);
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
  close() {
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
  transactionIsValid(txnData: Object): boolean {
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
  _addDirty(obj: Object, collection: string) {
    let collectionSet = this.dirtyMap.get(collection);

    if (!collectionSet) {
      collectionSet = new Set();
      this.dirtyMap.set(collection, collectionSet);
    }

    collectionSet.add(obj);
    if (this.atomicLevel == 0) {
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

      for (let obj of objSet) {
        obj._addToTransaction(objectStore, this.version);
        added.push(obj);
      }
    }

    this.committing++;
    this.dirtyMap.clear();

    // For now we opt to refresh readers before the commit is complete.
    // This means we could show the user updates that haven't been committed,
    // and could technically become lost.  If we really wanted to we could wait
    // to refresh readers until the commit was successful, but it seems unlikely
    // that this would be worth it (unless perhaps we were a server).
    this._refreshReaders();

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

  _refreshReaders() {
    // OPT: if we wanted to we would optimize this to only refresh readers that
    // actually changed.  But we generally expect there to be a relatively small
    // number of readers, and we expect refreshing them from in-memory data
    // to be very cheap.

    // Need to refresh EntryLists first because Readers may depend on their
    // contents.
    for (let entryList of this.entryLists) {
      entryList._refresh();
    }

    for (let reader of this.readers) {
      reader._refresh();
    }
  }

  static _getDbKey(data: Object, collection): string {
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
  atomic(func: Function) {
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
  createAccount(accountData: Object): Account {
    return new Account(this, accountData);
  }

  /**
   * Adds a transaction.  The transaction must be valid.  The guid should not
   * be set.
   *
   * @param txnData The transaction to add.
   */
  createTransaction(txnData: Object): Transaction {
    return new Transaction(this, txnData);
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
  getRealRoot(): Account {
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
  getNominalRoot(): Account {
    return this.accountsByGuid.get("NOMINAL_ROOT");
  }

  /**
   * Gets an account by guid, or undefined if no account has this guid.
   *
   * Since all accounts are loaded at all times, the account is returned
   * directly (not a promise).
   */
  getAccountByGuid(guid: string): ?Account {
    return this.accountsByGuid.get(guid);
  }

  /**
   * Gets a transaction by guid.  Returns a promise, since the transaction may
   * need to be loaded first.  If the transaction exists, the promise succeeds
   * and yields the transaction, otherwise the promise fails.
   */
  getTransactionByGuid(guid: string): Promise<Transaction> {
    return new Promise(function(resolve, reject) {
      // At the moment we keep all transactions loaded at all times.
      resolve(this.transactionsByGuid.get(guid));
    });
  }

  _getSumByKey(account:Account, periodKey:string): Sum {
    let key = account.data.guid + ";" + periodKey;
    let ret = this.sumsByKey.get(key);
    if (ret) {
      return ret;
    } else {
      ret = new Sum(this, key)
      this.sumsByKey.set(key, ret);
      return ret;
    }
  }

  _getSum(account: Account, date: Date, period: SummingPeriod): Sum {
    return this._getSumByKey(account, period.getSumKey(period.roundDown(date)));
  }

  _getAmountReadersForPeriod(account: Account,
                             startDate: Date,
                             endDate: Date): Array<IGetAmount> {
    return SummingPeriod.getSumKeysForRange(startDate, endDate).map(
      (key) => this._getSumByKey(account, key).toIGetAmount()
    );
  }

  /**
   * Parse a date in DB format (YYYY-MM-DD) and returns a Date object.
   * Since we internally interpret Date objects as local time (not UTC)
   * we need to replace "-" characters in the date with "/", so that the
   * Date constructor will parse them as local time.
   */
  static parseDate(dateStr: string): Date {
    return new Date(dateStr.replace(/-/g, "/"));
  }
}

/** DbUpdater *****************************************************************/

const ObjectStates = {
  ADD_PENDING: 0,
  UPDATE_PENDING: 1,
  COMMITTED: 2,
  DELETE_PENDING: 3,
  DELETED: 4
};

class DbObject extends Observable {
  db: DB;
  dbUpdater: DbUpdater;
  version: number;

  toModel(): Object { throw "Must override"; }
  getVersion(): number { return this.version; }
}

/**
 * Internal class used by DB-backed objects (Account, Transaction, Sum) to flush
 * changes to the DB.
 */
class DbUpdater {
  db: DB;
  collection: string;
  obj: DbObject;
  state: number;
  key: string;

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
      this.state = ObjectStates.DELETED;
    } else {
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
    this.checkOkToUpdate();

    if (true) {
      let key = DB._getDbKey(this.obj.toModel(), this.collection);

      if (key != this.key) {
        console.log("Old key: ", this.key, "New key: ", key);
        throw "Update should not change key!";
      }
    }

    if (this.state == ObjectStates.COMMITTED) {
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
export class Account extends DbObject {
  db: DB;
  data: Object;
  parent: ?Account;
  children: SortedMap<string, Account>;

  /**
   * Constructor is not public: clients should create new accounts with
   * db.createAccount().  This constructor is for use of the DB only.
   * @private
   */
  constructor(db: DB, data: Object, existsInDb: ?boolean) {
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
      let parent = this.parent;
      parent.children.set(data.name, this);
      parent._notifySubscribers();
    }

    this.dbUpdater = new DbUpdater(db, "accounts", this, existsInDb);
  }

  toModel(): Object { return this.data; }

  /**
   * Returns true if the given account is valid in isolation.
   * Does not validate things external to this account, like that the parent
   * account must exist.
   */
  static isValid(accountData) {
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
  update(newData: Object) {
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

      if (!oldParent) {
        throw "cannot reparent root account.";
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
      let parent = this.parent;
      parent.children.delete(this.data.name);
      parent._notifySubscribers();
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
   */
  newBalanceReader(options: BalanceReaderOptions): BalanceReader {
    return new BalanceReader(this, options);
  }

  /**
   * Returns a new EntryReader that vends a sequence of Entry objects for this
   */
  newEntryReader(options: Object): EntryReader {
    return new EntryReader(this, options);
  }

}

/** Entry *********************************************************************/

/**
 * Class that represents a single entry of a transaction.  Every Transaction has
 * two or more of these.  An Entry represents the effects of a transaction on a
 * single account.
 *
 * Entry does *not* provide the current balance of the account.  For that, use
 * account.newEntryReader(), which will provide Entry objects *along with*
 * current balance data.
 *
 * These Entry objects are not 1:1 with Transaction entries in the database.
 * We create extra Entry objects for parent accounts of the actual DB entry,
 * so we'll always create more Entry objects than the DB has.
 */
class Entry {
  txn: Transaction;
  account: Account;
  description: string;
  data: Object;
  amount: Amount;
  sums: Array<Sum>;

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
    this.sums = SummingPeriod.periods2.map(
      (p) => txn.db._getSum(account, txn.date, p)
    );
  }

  /**
   * Returns the date of this Entry.
   */
  getDate(): Date {
    return this.txn.getDate();
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
    return this.data.description || this.txn.data.description;
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
export class Transaction extends DbObject {
  data: Object;
  date: Date;
  entries: Map<Account, Entry>;

  /**
   * Constructor is not public: clients should create new transactions with
   * db.createTransaction().  This constructor is for use of the DB only.
   * @private
   */
  constructor(db: DB, txnData: Object, existsInDb: ?boolean) {
    super()

    this.db = db;
    this.data = txnData;
    this.date = DB.parseDate(txnData.date);

    if (!this.db.transactionIsValid(txnData)) {
      throw "invalid transaction";
    }

    if (txnData.guid) {
      if (this.db.transactionsByGuid.get(txnData.guid)) {
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

  toModel(): Object { return this.data; }

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


  _createEntries(add: boolean) {
    this.entries = new Map();

    for (let i in this.data.entry) {
      let entryData = this.data.entry[i];
      let account = this.db.accountsByGuid.get(entryData.account_guid);

      if (!account) {
        throw "Account doesn't exist?";
      }

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
      // FLOW BUG -- this isn't accepted:
      // } while ((account = account.parent) != null);
        if (account.parent) {
          account = account.parent;
        } else {
          break;
        }
      } while (true);

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
   * Returns the entry for the given account in this transaction, or null
   * if there is no entry for this account.
   *
   * TODO(haberman): will need to add a date parameter if/when transactions
   * can have multiple entries for the same account, but on different days.
   */
  getEntry(account: Account) {}

  /**
   * Returns the date of this transaction.
   *
   * TODO(haberman): will need to add a date parameter if/when transactions
   * can have multiple entries for the same account, but on different days.
   */
  getDate(): Date {
    return this.date;
  }

  /**
   * Updates an existing transaction.  Transaction guid must be set, and the
   * transaction must be valid.  This will completely overwrite the previous
   * value of this transaction.
   */
  update(newData: Object) {
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
   * Internal only method to calculate the key for this transaction in the
   * sorted map.
   */
  _byTimeKey(): string {
    return this.data.date + this.data.guid;
  }
}

/** Sum ***********************************************************************/

/**
 * Class that represents the sum of all entry amounts for a particular account
 * (and its children) over a window of time.
 *
 * This class is internal-only.  It is not actually observable despite deriving
 * DbObject < Observable (we're compensating a lack of multiple inheritance).
 */
class Sum extends DbObject {
  key: string;
  amount: Amount;
  count: number;

  // Implements the interface IGetAmount.
  toIGetAmount(): IGetAmount {
    return ((this: any): IGetAmount);
  }

  constructor(db, key, data) {
    super();

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

  getAmount(): Amount { return this.amount; }

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

/** EntryList *****************************************************************/

class EntryListOptions {
  // Users must specify two of three of these options.
  //
  // When specifying an endDate and minCount, the actual count will be
  // increased so that all entries for the first day are included in the list.

  minCount: ?number;
  startDate: ?Date;
  endDate: ?Date;
}

/**
 * Class that provides an up-to-date list of entries for a given account in some
 * time window.
 *
 * This type is sort of like EntryReader except it does not provide the overall
 * account balance for each entry, just the amount (delta) for this transaction.
 * EntryList is used by both EntryReader and BalanceReader (BalanceReader only
 * uses it when no pre-computed sum is available at the right granularity).
 * Also EntryList is internal-only while EntryReader is used directly by users.
 */
class EntryList {
  db: DB;
  account: Account;
  entries: Array<Entry>;
  amount: ?Amount;

  options: EntryListOptions;

  constructor(account: Account, options: EntryListOptions) {
    this.db = account.db;
    this.account = account;
    this.options = options;

    let has = 0;

    if (options.minCount) { has++; }
    if (options.startDate) { has++; }
    if (options.endDate) { has++; }

    if (has != 2) {
      throw "Must specify 2 of: minCount, startDate, endDate";
    }
  }

  /**
   * Returns the sum of the amounts for all entries in the list.
   * We compute it lazily, since it is not always required.
   */
  getAmount(): Amount {
    if (this.amount) {
      return this.amount;
    } else {
      let amount = new Amount();
      for (let entry of this.entries) {
        amount.add(entry.getAmount());
      }
      this.amount = amount;
      return amount;
    }
  }

  /**
   * Returns the list of entries for these criteria.
   * Entries are returned in ascending date order.
   */
  getEntries(): Array<Entry> {
    return this.entries;
  }

  _refresh() {
    this.entries = []
    this.amount = null;
    let options = this.options;

    if (options.startDate) {
      // All cases except [endDate, count].
      // Iterate forwards, adding entries until we hit our stop criterion.
      //
      // $FlowIssue: Doesn't recognize the iterator.
      for (let txn of this.db.transactionsByTime.iterator(options.startDate)) {
        let entry = txn.getEntry(this.account);

        if ((options.endDate && entry.getDate() > options.endDate) ||
            (options.minCount && options.minCount == this.entries.length)) {
          break;
        }

        this.entries.push(entry);
      }
    } else {
      // The case of [endDate, count].
      // Iterate backwards, adding entries until we hit our minCount.

      let firstDate = null;

      // $FlowIssue: Doesn't recognize the iterator.
      for (let txn of this.db.transactionsByTime.riterator(this.endDate)) {
        let entry = txn.getEntry(this.account);

        if (firstDate && entry.getDate() < firstDate) {
          break;
        }

        this.entries.push(entry);

        if (options.minCount == this.entries.length) {
          // We don't stop iteration until we have all of the entries for this
          // day.  This is important for computing overall balances.
          firstDate = entry.getDate();
        }
      }
      this.entries.reverse();
    }
  }
}


/** BalanceReader *************************************************************/

const Periods = new Set(["DAY", "WEEK", "MONTH", "QUARTER", "YEAR", "FOREVER"]);

// These limits shouldn't be too wide until we have smarter logic about tracking
// min/max transaction per account.
export const DateLimits = {
  MIN_DATE: new Date("2000/01/01"),
  MAX_DATE: new Date("2020/01/01"),
};

class Reader extends Observable {
  account: Account;
  db: DB;

  constructor(account: Account) {
    super();

    this.db = account.db;
    this.db.readers.add(this);
  }

  _refresh() {}

  release() {
    this.db.readers.delete(this);
  }
}

// An interface implemented by Sum and EntryList.
class IGetAmount {
  getAmount(): Amount { throw "Must override in a derived class."; }
  getVersion(): number { throw "Must override in a derived class."; }
}

/**
 * The objects that are vended by BalanceReader.
 */
class BalanceReaderPoint {
  // Represents the beginning and end of the period.
  // The end date is 1ms before the beginning of the next start date.
  startDate: Date;
  endDate: Date;

  // The overall balance for this account at the start/end of the period.
  startBalance: Amount;
  endBalance: Amount;

  // The change in balance over this period (endBalance - startBalance).
  delta: Amount;
}

class BalanceReaderOptions {
  // How many time windows should be part of the sequence (default: 1).
  count: number;

  // Specify either startDate OR endDate (but not both).
  // The first (or last) period of the series will include this date.
  startDate: Date;
  endDate: Date;

  // TODO: add an "exclude future transactions" flag?
  // That would let users get an "year-to-date" value (for example) without
  // including future (ie. speculative) transactions.

  // Frequency of points.
  // Valid values are: "DAY", "WEEK", "MONTH", "QUARTER", "YEAR",
  //                   "FOREVER".
  // "FOREVER" is only valid when count = 1.
  frequency: string;
}

class BalanceReaderPeriod {
  startDate: Date;
  endDate: Date;
  amounts: Array<IGetAmount>;
}

class BalanceReader extends Reader {
  db: DB;
  periods: Array<BalanceReaderPeriod>;
  points: Array<BalanceReaderPoint>;
  initialSums: Array<IGetAmount>;
  version: number;

  constructor(account, options) {
    super(account);

    if (!Periods.has(options.frequency)) {
      throw "Unknown frequency: " + options.frequency;
    }

    // Instead of these rules, we could implement a 2-of-3 for startDate,
    // endDate, count.
    if (options.frequency == "FOREVER") {
      if (options.count && options.count != 1) {
        throw "FOREVER frequency requires count == 1 (or omit it)";
      }
    }

    this.db = account.db;
    this.db.readers.add(this);

    this.periods = [];
    this.version = 0;

    if (options.frequency == "FOREVER") {
      if (options.count && options.count != 1) {
        throw "FOREVER frequency requires count == 1 (or omit it)";
      }
      this.periods.push({
        startDate: DateLimits.MIN_DATE,
        endDate: DateLimits.MAX_DATE,
        amounts: [],
      });
    } else {
      /*
      let step, date;

      if (options.startDate) {
        if (options.endDate) {
          throw "Specifying both start and end date isn't supported yet.";
        }
        date = options.startDate;
        step = 1;
      } else {
        if (!options.endDate) {
          throw "Must specify one of startDate, endDate";
        }
        date = options.endDate;
        step = -1;
      }

      if (!options.count) {
        throw "Must specify count (for now).";
      }

      this._pushPeriod(date);

      if (options.frequency == "DAY") {
        for (let i = 1; i < options.count; i++) {
          date.setDate(date.getDate() + step);
          this._pushPeriod(date, options.frequency);
        }
      } else if (options.frequency == "WEEK") {
        for (let i = 1; i < options.count; i++) {
          date.setDate(date.getDate() + (step * 14));
          this._pushPeriod(date, options.frequency);
        }
      } else if (options.frequency == "MONTH") {
        for (let i = 1; i < options.count; i++) {
          date.setMonth(date.getMonth() + step);
          this._pushPeriod(date, options.frequency);
        }
      } else if (options.frequency == "QUARTER") {
        for (let i = 1; i < options.count; i++) {
          date.setMonth(date.getMonth() + (step * 3));
          this._pushPeriod(date, options.frequency);
        }
      } else if (options.frequency == "YEAR") {
        for (let i = 1; i < options.count; i++) {
          date.setYear(date.getFullYear() + step);
          this._pushPeriod(date, options.frequency);
        }
      }

      if (step == -1) {
        // So the points are in forwards chronological order.
        this.periods_.reverse();
      }
      */
    }

    for (let period of this.periods) {
      period.amounts = this.db._getAmountReadersForPeriod(
          account, period.startDate, period.endDate);
    }

    this.initialSums = this.db._getAmountReadersForPeriod(
        account, DateLimits.MIN_DATE, this.periods[0].startDate);

    this._refresh();
  }

  _refresh() {
    // Re-compute the pre-computed sums.
    var maxVersion = 0;

    let total = new Amount();
    this.points = [];
    for (let sum of this.initialSums) {
      maxVersion = Math.max(maxVersion, sum.getVersion());
      total.add(sum.getAmount());
    }
    let last_end = total.dup();

    for (let period of this.periods) {
      let periodAmount = new Amount();
      for (let sum of period.amounts) {
        maxVersion = Math.max(maxVersion, sum.getVersion());
        periodAmount.add(sum.getAmount());
      }

      let point = {
        startDate: period.startDate,
        endDate: period.endDate,
        startBalance: last_end,
        endBalance: last_end.dup(),
        delta: periodAmount,
      }

      point.endBalance.add(periodAmount);

      this.points.push(point);
      last_end = point.endBalance;
    }

    if (maxVersion > this.version) {
      this._notifySubscribers();
      this.version = maxVersion;
    }
  }

  getPoints(): Array<BalanceReaderPoint> {
    return this.points;
  }

  release() {
    this.db.readers.delete(this);
  }
}

/** EntryReader ***************************************************************/

class EntryReaderEntry {
  entry: Entry;
  balance: Amount;
}

class EntryReaderOptions {
  // Users must specify two of three of these options.

  // How many transactions should be part of the sequence.
  count: ?number;

  // String format; one of:
  //   YYYY-MM-DD
  //   YYYY-MM-DD+N (to skip N entries after the beginning of this date).
  startDate: ?string;

  // String format; one of:
  //   YYYY-MM-DD
  //   YYYY-MM-DD-N (to skip N entries before the end of this date).
  endDate: ?string;
}

class EntryReader extends Reader {
  account: Account;
  initialSums: Array<IGetAmount>;
  list: EntryList;
  entries: Array<EntryReaderEntry>;

  startSkip: ?number;
  endSkip: ?number;
  count: ?number;

  constructor(account, options: EntryReaderOptions) {
    super(account);

    let listOptions = new EntryListOptions();

    let has = 0;

    if (options.count) {
      this.count = options.count;
      listOptions.minCount = options.count;
      has++;
    }

    if (options.startDate) {
      let parts = options.startDate.split("+");
      listOptions.startDate = DB.parseDate(parts[0]);
      this.startSkip = parseInt(parts[1] || "0", 10);

      // If the user asked us to skip some entries, we ask for extra entries
      // from the list and skip over them.
      listOptions.minCount += this.startSkip;
      has++;
    }

    if (options.endDate) {
      let parts = options.endDate.split("-");
      listOptions.endDate = DB.parseDate(parts[0]);
      this.endSkip = parseInt(parts[1] || "0", 10);

      // If the user asked us to skip some entries, we ask for extra entries
      // from the list and skip over them.
      listOptions.minCount += this.endSkip;
      has++;
    }

    if (has != 2) {
      throw "Must provide two of: startDate, endDate, count";
    }

    this.list = new EntryList(account, listOptions);
  }

  _refresh() {
    let entryListEntries = this.list.getEntries();
    let entries = [];

    if (entryListEntries.length == 0) {
      return;
    }

    let initialSums = this.db._getAmountReadersForPeriod(
        this.account, DateLimits.MIN_DATE, entryListEntries[0].getDate());
    entries = [];

    let balance = new Amount();

    for (let sum of initialSums) {
      balance.add(sum.getAmount());
    }

    for (let entry of this.list.getEntries()) {
      balance.add(entry.getAmount());
      entries.push(new EntryReaderEntry(entry, balance.dup()));
    }

    if (this.endSkip != null) {
      entries.splice(-this.endSkip, this.endSkip);
    }

    if (this.startSkip != null) {
      entries.splice(0, this.startSkip);
    }

    if (this.count != null) {
      let excess = entries.length - this.count;

      if (excess > 0) {
        if (this.startSkip != null) {
          throw "Unexpected: reader with startSkip / count had extra elems.";
        } else {
          // This is expected in the case that the EntryList returned extra
          // entries at the beginning to give us the complete day's worth.
          entries.splice(0, excess);
        }
      }
    }

    this.entries = entries;
  }

  getEntries(): Array<EntryReaderEntry> {
    return this.entries;
  }
}
