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
 * Returns true if the given account is valid in isolation.
 * Does not validate things external to this account, like that the parent
 * account must exist.
 */
dblbook.accountIsValid = function(account) {
  var ret = typeof account.name == "string" &&
      typeof account.type == "string" &&
      typeof rootForType(account.type) == "string";
  if (!ret) {
    console.log("Invalid account: ", account);
  }
  return ret;
}

/**
 * If the transaction is unbalanced, returns the unbalanced balance.
 * Otherwise, (if the transaction is balanced), returns null.
 */
dblbook.unbalancedTransactionAmount = function(txn) {
  var unbalanced = new dblbook.Balance();

  for (var i in txn.entry) {
    var entry = txn.entry[i]
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
dblbook.transactionIsValid = function(txn) {
  if (typeof txn.timestamp != "number" ||
      typeof txn.description != "string" ||
      !dblbook.isArray(txn.entry) ||
      txn.entry.length < 2) {
    return false;
  }

  for (var i in txn.entry) {
    var entry = txn.entry[i]
    if (typeof entry.account_guid != "string" ||
        entry.account_guid == "REAL_ROOT" ||
        entry.account_guid == "NOMINAL_ROOT" ||
        !dblbook.isArray(entry.amount) ||
        entry.amount.length < 1) {
      return false;
    }
  }

  if (dblbook.unbalancedTransactionAmount(txn)) {
    return false;
  }

  return true;
}

/**
 * Class for representing a set of accounts and transactions for some entity
 * (like a person or a business).
 *
 * This object maintains a consistent view of the data.  Some data is kept
 * directly in memory (as JS objects), the data is always written to a local
 * indexedDB, and the data can optionally be replicated to/from some kind of
 * cloud storage also.
 *
 * If we get fancy later on this might grow some functionality for performing
 * merges if there were concurrent mutations.
 *
 * TODO: The name "Entity" isn't super clear.  Nothing better comes to mind at
 * the moment.
 * @constructor
 */
dblbook.openDB = function(callback) {
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

    if (dblbook.DB.created) {
      callback(null, "Only one DB object allowed");
      idb.close();
    } else {
      dblbook.DB.created = true;
      var db = new dblbook.DB(idb, callback);
      callback(db);
    }
  }

  request.onerror = function() {
    callback(null, "error opening IndexedDB");
  }
}

dblbook.obliterateDB = function(callback) {
  var request = indexedDB.deleteDatabase("dblbook");
  request.onsuccess = function() {
    callback();
  }
  request.onerror = function(event) {
    console.log("Error in obliterate", event);
  }
}

dblbook.DB = function(idb, callback) {
  var self = this;

  this.idb = idb;
  this.accountsByGuid = {
    "REAL_ROOT": new dblbook.Account(this),
    "NOMINAL_ROOT": new dblbook.Account(this),
  };

  this.subscriptionsByObj = new Map();
  this.subscriptionsBySubscriber = new Map();

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
        self._doCreateAccount(account);
      });

      // Better to delay callback until here?
      // Prevents updating after page load, but is that better?
      // It actually feels slightly faster to get a blank page and have it
      // fill in.
      //callback(self);
    }
  }

  /*

  var txn = this.db.transaction("transactions", "readonly");
  var store = tx.objectStore("transactions");
  var index = store.index("date_order");

  var request = index.openCursor().onsuccess = function() {
    var cursor = request.result;
    if (cursor) {

    }
  }
  */
}

/**
 * Adds a new account to the in-memory model, but not into the database.
 *
 * Useful when loading accounts from the database.
 *
 * @param accountData Data for the account to add (to match model.proto).
 */
dblbook.DB.prototype._doCreateAccount = function(account) {
  if (!dblbook.accountIsValid(account)) {
    throw "invalid account";
  }

  var parentGuid = account.parent_guid || rootForType(account.type);
  var parent = this.accountsByGuid[parentGuid];

  if (!parent) {
    throw "parent account does not exist.";
  }

  if (parent.children[account.name]) {
    throw "account already exists with this name";
  }

  if (account.guid) {
    if (this.accountsByGuid[account.guid]) {
      throw "Tried to duplicate existing account";
    }
  } else {
    account.guid = dblbook.guid();
  }

  Object.freeze(account);

  var accountObj = new dblbook.Account(this, account, parent);

  this.accountsByGuid[account.guid] = accountObj;
  parent.children[account.name] = accountObj;

  this._notifyChange(parent);

  return accountObj;
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
    if (!this.accountsByGuid[entry.account_guid]) {
      return false;
    }
  }

  return true;
}

/**
 * Adds a transaction into the in-memory model, but not the database.
 *
 * Useful when loading transactions that already exist in the database.
 *
 * @param txn Data for a transaction (as in model.proto).
 */
dblbook.DB.prototype._doCreateTransaction = function(txn) {
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

  this.accountsByGuid[account.guid] = txnObj;
  parent.children[account.name] = txnObj;

  this._notifyChange(parent);

  return txnObj;
}

dblbook.DB.prototype.newWriteTransaction = function(stores) {
  var txn = this.idb.transaction(stores, "readwrite");
  txn.onerror = function(event) {
    console.log("Whoa, did not see that coming.", event);
    alert("Transaction failure!");
  }
  return txn;
}

dblbook.DB.prototype.close = function(account) {
  this.idb.close();
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
  var ret = this._doCreateAccount(accountData);
  var txn = this.newWriteTransaction(["accounts"]);
  txn.objectStore("accounts").add(accountData);
  return ret;
}

/**
 * Updates an existing account.  Constraints:
 *
 * 1. account for this guid must exist (and guid must be set).
 * 2. account must be valid.
 *
 * @param {Account} account The account to update.
 */
dblbook.DB.prototype.updateAccount = function(account) {
  if (!dblbook.accountIsValid(account)) {
    throw "invalid account";
  }

  if (!account.guid) {
    throw "guid required.";
  }

  var wrapped = this.accountsByGuid[account.guid];

  if (!wrapped) {
    throw "account does not exist.";
  }

  var oldParent = wrapped.parent;
  var newParent =
      this.accountsByGuid[account.parent_guid || rootForType(account.type)];

  if (!newParent) {
    throw "parent account does not exist.";
  }

  if (oldParent !== newParent || wrapped.data.name != account.name) {
    if (newParent.children[account.name]) {
      throw "account already exists with this name";
    }

    delete oldParent.children[wrapped.data.name];
    newParent.children[account.name] = wrapped;

    this._notifyChange(oldParent);
    this._notifyChange(newParent);

    wrapped.parent = newParent;
  }

  Object.freeze(account);

  wrapped.data = account;

  var txn = this.newWriteTransaction(["accounts"]);
  txn.objectStore("accounts").put(account);

  return wrapped;
}

/**
 * Deletes an existing account.  Constraints:
 *
 * 1. the account must exist.
 * 2. the account must not have any transactions that reference it.
 *
 * @param {string} accountGuid The guid of the account to delete.
 */
dblbook.DB.prototype.deleteAccount = function(accountGuid) {
  var account = this.accountsByGuid[accountGuid];

  if (!account) {
    throw "account does not exist.";
  }

  if (account.last) {
    throw "cannot delete account with any transactions";
  }

  if (account.parent) {
    delete account.parent.children[account.data.name];
    this._notifyChange(account.parent);
    // Should we notify the account itself?
    // Then any view that depends on it could just
    // redirect somewhere else?
  }

  var txn = this.newWriteTransaction(["accounts"]);
  txn.objectStore("accounts").delete(accountGuid);
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
 * Updates an existing transaction.  Transaction guid must be set, and the
 * transaction must be valid.  This will completely overwrite the previous
 * value of this transaction.
 *
 * @param {Transaction} transaction The new value for this transaction.
 */
dblbook.DB.prototype.updateTransaction = function(transaction) {
}

/**
 * Deletes an existing transaction.
 *
 * @param {string} transactionGuid The guid of the transaction to delete.
 */
dblbook.DB.prototype.deleteTransaction = function(transactionGuid) {
}

/**
 * Returns a list of top-level accounts.
 *
 * The returned accounts are plain JavaScript objects with the following
 * members:
 *
 * @return {Array} An array of account objects.
 */
dblbook.DB.prototype.getRealRoot = function() {
  return this.accountsByGuid["REAL_ROOT"];
}

dblbook.DB.prototype.getNominalRoot = function() {
  return this.accountsByGuid["NOMINAL_ROOT"];
}

/**
 * Subscribes to changes for this object.
 * Overwrites any existing callback for this obj/subscriber pair.
 */
dblbook.DB.prototype.subscribe = function(subscriber, obj, cb) {
  dblbook.appendNested(this.subscriptionsByObj, obj, subscriber, cb);
  dblbook.appendNested(this.subscriptionsBySubscriber, subscriber, obj, true);
}

/**
 * Unsubscribes to whatever we subscribed to as this subscriber.
 */
dblbook.DB.prototype.unsubscribe = function(subscriber) {
  var self = this;
  this.subscriptionsBySubscriber.get(subscriber).forEach(function(val, obj) {
    console.log(obj);
    dblbook.removeNested(self.subscriptionsByObj, obj, subscriber);
  });
  this.subscriptionsBySubscriber.delete(subscriber);
}

dblbook.DB.prototype._notifyChange = function(obj) {
  var subscribers = this.subscriptionsByObj.get(obj);

  if (subscribers) {
    subscribers.forEach(function(cb) { cb(); });
  }
}

dblbook.DB.prototype._addTimeSeries = function(timeSeries) {
  timeSeries.values = ["$1000"];
}

dblbook.DB.prototype._addRegister = function(timeSeries) {
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
dblbook.Account = function(db, data, parent) {
  this.db = db;
  this.data = data;
  this.parent = parent;
  this.children = {};
}

dblbook.Account.prototype.newTimeSeries = function() {
  return new dblbook.TimeSeries(this.db);
}

/*
 * All the transactions ("last" and everything linked from it) are plain
 * JavaScript objects with the following members:
 *
 * - db: link back to the database
 * - data: the raw data for this Transaction (as in model.proto)
 * - accounts: an object mapping account guid to account info, only for accounts
 *   that have entries in this transaction (and their parents). Each account
 *   info object contains:
 *
 *   - description: effective description (including defaulting txn's).
 *   - date: either string postdate (for display) or integer timestamp from txn.
 *   - amount: dblbook.Balance: amount for this txn.
 *   - balance: dblbook.Balance: current cumulative balance for this account
 *     (includes all transactions for this account and all sub-accounts).
 *   - next: next transaction by time for this account (or any sub-account).
 *   - prev: prev transaction by time for this account (or any sub-account).
 *
 *   Note that next/prev are by the account entry's *post* date, not the
 *   transaction date, so the "next" transaction may not actually have a later
 *   transaction time!
 */
dblbook.Transaction = function(db, data) {
  this.db = db;
  this.data = data;
}

/**
 * Class for representing a time-series; for example the balance of an account
 * over time.
 *
 * These properties are provided, all of which are read-only:
 * - db: link back to the database
 * - account: link to the Account for this TimeSeries
 * - values: array of values (either Decimal objects or Balance objects).
 * - times: an array of times corresponding to the values.
 *
 * @constructor
 */
dblbook.TimeSeries = function(db, account) {
  this.db = db;
  this.account = account;
  this.db._addTimeSeries(this);
}

/**
 * Call when you no longer need the TimeSeries object.
 * This will free the DB from having to update it every time anything changes.
 */
dblbook.TimeSeries.prototype.release = function() {
}

/**
 * Class for representing a register; a list of transactions for an account
 * (and possibly sub-accounts).
 */
dblbook.Register = function(db, account) {
  this.db = db;
  this.account = account;
  this.db._addRegister(this);
}

/**
 * Call when you no longer need the Register object.
 * This will free the DB from having to update it every time anything changes.
 */
dblbook.Register.prototype.release = function() {
}
