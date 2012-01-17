/**
 * @fileoverview Core data types for amounts, balances, currencies, etc.
 * Inspired by Ledger (http://ledger-cli.org).
 * @author jhaberman@gmail.com (Josh Haberman)
 */

var dblbook = {};

function AssertException(message) { this.message = message; }
AssertException.prototype.toString = function () {
  return 'AssertException: ' + this.message;
}

function assert(exp, message) {
  if (!exp) throw new AssertException(message);
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
 * Returns a new object is this added to "other".
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
  return (this.value / Math.pow(10, this.precision)).toFixed(this.precision);
};

/**
 * Class for representing the balance of an account.  Contains a set of decimal
 * balances and their associated commodities (currencies).
 * @constructor
 */
dblbook.Balance = function() {
  this.commodities = new Object();
};

/**
 * Adds the given amount in the given commodity to this balance.
 * @param {Decimal} amount The amount to add.
 * @param {String} commodity The commodity of the amount (eg. "USD").
 */
dblbook.Balance.prototype.add = function(amount, commodity) {
  if (!(commodity in this.commodities)) {
    this.commodities[commodity] = new dblbook.Decimal();
  }
  this.commodities[commodity] = this.commodities[commodity].add(amount);
};

dblbook.Balance.prototype.dup = function() {
  var ret = new dblbook.Balance();
  for (var commodity in this.commodities) {
    ret.add(this.commodities[commodity], commodity);
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
  return strs.join(", ");
};

/**
 * Given an array of transactions, returns an array that contains both the
 * transaction and the balance.
 */
dblbook.calculateBalances = function(txns, default_commodity) {
  var txns_with_balance = new Array();
  var balance = new dblbook.Balance();
  var l = txns.length;
  for (var i = 0; i < l; i++) {
    var txn = txns[i];
    balance.add(new dblbook.Decimal(txn.amount),
                txn.commodity || default_commodity);
    txns_with_balance.push({"txn": txn, "balance": balance.dup()});
  }
  return txns_with_balance;
}
