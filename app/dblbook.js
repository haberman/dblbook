
Array.prototype.last = Array.prototype.last || function() {
    var l = this.length;
    return this[l-1];
}

var amountField = {
  create: function(options) {
    var ret =  ko.observable(new dblbook.Balance(options.data));
    return ret;
  },
  //update: function(options) {
  //  return options.data.toString();
  //},
}

var transactionMapping = {
  include: ['id', 'date', 'amount', 'description'],
  ignore: ['balance'],
  //key: function(data) { return ko.utils.unwrapObservable(data.id) },
  'amount': amountField,
}


/**
 * The same register can be shared between multiple accounts, so we have a
 * container object cache and vend these registers.
 *
 * @constructor
 */
function RegisterCache() {
  this.registers = {};
}

RegisterCache.prototype.get = function(id) {
  if (!this.registers[id]) {
    var data = localStorage.getItem(id);
    var register = ko.observableArray();
    if (data) {
      var lastTxn = null;
      var f = function() { return this[0].balance().add(this[1].amount()); }
      data.split("\n").forEach(function(line) {
        var txn = ko.mapping.fromJS(JSON.parse(line), transactionMapping);
        txn.balance = lastTxn ? ko.computed(f, [lastTxn, txn]) : txn.amount;
        register.push(txn);
        lastTxn = txn;
      });
    }
    registers[id] = register;
  }
  return registers[id];
}

var registers = new RegisterCache;

/**
 * Mappings to load/store our in-memory objects to JSON/localStorage, using
 * Knockout.mapping.
 */
var accountMapping = {
  include: ['id', 'name', 'real'],
  ignore: ['balance'],
  //key: function(data) { return ko.utils.unwrapObservable(data.id); },
};

var entityMapping = {
  include: ['name', 'accounts'],
  //'id': {
  //  create: function(options) {
  //    var id = options.data;
  //    // Load the ledger for this entity.
  //    var ledger = loadLedger(id);
  //    options.parent.ledger = ledger;
  //    return ko.mapping.fromJS(id);
  //  },
  //},
  'accounts': {
    create: function(options) {
      var ret = ko.mapping.fromJS(options.data, accountMapping);
      // Load the register for this account.
      ret.register = registers.get(ret.id());
      ret.balance = ko.computed(function() {
        var reg = ret.register() || [];
        return reg.length > 0 ? reg.last().balance() : new dblbook.Balance();
      });
      return ret;
    },
  },
};

var configMapping = {
  include: ['entities'],
  'entities': {
    create: function(options) {
      var entity =  ko.mapping.fromJS(options.data, entityMapping);
      // An entity's net worth is the sum of the balances of its real accounts.
      entity.netWorth = ko.computed(function() {
        var ret = entity.accounts().reduce(function(sum, acct) {
          return acct.real ? sum.add(acct.balance()) : sum;
        }, new dblbook.Balance());
        return ret;
      });
      entity.url = "#entity/" + entity.id()
      return entity;
    },
  },
};

function loadConfig() {
  var configData = JSON.parse(localStorage.getItem("config"));
  return ko.mapping.fromJS(configData, configMapping)
}

var config = loadConfig();
var breadcrumbs = ko.observableArray();
ko.applyBindings({"breadcrumbs": breadcrumbs}, $("#nav").get(0));

var controller = ko.observable();

function route(str) {
  var match;
  if (match = str.match(/^#entity\/(\w+)$/)) {
    var entity = config.entities().filter(function(o) { return o.id() == match[1]; })[0];
    controller({
      template: "entity",
      data: entity,
    });
    breadcrumbs([{label: entity.name(), url: entity.url}]);
  } else {
    controller({
      template: "home",
      data: config
    });
    breadcrumbs([]);
  }
}

route(document.location.hash);
ko.applyBindings(controller, $("#content").get(0));

window.addEventListener("hashchange", function() {
  route(document.location.hash);
});
