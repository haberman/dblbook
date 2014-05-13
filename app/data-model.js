/**
 * @fileoverview Core data types for amounts, balances, currencies, etc.
 * Inspired by Ledger (http://ledger-cli.org).
 * @author jhaberman@gmail.com (Josh Haberman)
 */

var dblbook = {};

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
    console.log(sum.toString())
    if (sum.toString() == "0") {
      delete ret.commodities[commodity];
    } else {
      ret.commodities[commodity] = sum;
    }
  }
  console.log("A + B = C")
  console.log(this)
  console.log(other)
  console.log(ret)
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
    //console.log(commodity);
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
 * This object abstracts away the specific storage backend.  We provide a
 * transactional update API, but it is up to the specific implementation when
 * or if this is committed to a transactional data store or whether it is
 * replicated anywhere.
 *
 * If we get fancy later on this might grow some functionality for performing
 * merges if there were concurrent mutations.
 *
 * TODO: The name "Entity" isn't super clear.  Nothing better comes to mind at
 * the moment.
 * @constructor
 */
dblbook.openDB = function(callback) {
  var self = this;
  var version = 1;
  var request = indexedDB.open("dblbook", version);

  request.onupgradeneeded = function(e) {
    var db = request.result;
    var store = db.createObjectStore("transactions", {keyPath: "guid"});
    var date_order = store.createIndex("time_order", "timestamp")

    store = db.createObjectStore("accounts", {keyPath: "guid"});
  }

  request.onsuccess = function() {
    if (dblbook.DB.created) {
      callback(null, "Only one DB object allowed");
    } else {
      dblbook.DB.created = true;

      var db = new dblbook.DB();
      db.db = request.result;
      db._load();
      callback(db);
    }
  }

  request.onerror = function() {
    callback(null, "error opening IndexedDB");
  }
}

dblbook.DB = function() {
}

dblbook.DB.prototype._load = function() {
  this._transactions = [];
  this._accounts = [];
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
 * Adds an account.  Constraints:
 *
 * 1. account guid must not be set (one will be assigned).
 * 2. account must be valid.Account name and type should be set, but guid should be
 * unset (the object will assign one appropriately).  The parent_guid must be
 * set; for a top-level account the special value GUID_TOP should be used.
 *
 * @param {Account} account The account to add.
 */
dblbook.DB.prototype.createAccount = function(account) {
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
 * - db: link back to the database
 * - data: the raw data for this Account (as in model.proto)
 * - balance: the account's balance as of the newest transaction
 * - parent: the parent account, or null if this is at the top level.
 * - children: an array of children, which may be empty.
 *
 * @return {Array} An array of account objects.
 */
dblbook.DB.prototype.accounts = function() {
  return this._accounts;
}

/**
 * Returns a list of transactions, in chronological order.
 * We will likely want to support lazy loading, in which case this return all
 * *loaded* transactions.
 *
 * The returned transactions are plain JavaScript objects with the following
 * members:
 *
 * - db: link back to the database
 * - data: the raw data for this Transaction (as in model.proto)
 * - accounts: an object mapping account guid to account info, only for accounts
 *   that have entries in this transaction (and their parents). Each account
 *   info object contains:
 *
 *   - balance: current cumulative balance for this account (includes all
 *     transactions for this account and all sub-accounts).
 *   - next: next transaction by time for this account.
 *   - prev: prev transaction by time for this account.
 *
 *   Note that next/prev are by the account entry's *post* date, not the
 *   transaction date, so the "next" transaction may not actually have a later
 *   transaction time!
 *
 * @return {Array} An array of transaction objects.
 */
dblbook.DB.prototype.transactions = function() {
  return this._transactions;
}
