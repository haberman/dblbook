
Array.prototype.last = Array.prototype.last || function() {
    var l = this.length;
    return this[l-1];
}

function strcmp(a, b) { return a == b ? 0 : (a < b ? -1 : 1); }

function guid() {
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    var r = Math.random()*16|0, v = c == 'x' ? r : (r&0x3|0x8);
    return v.toString(16);
  });
}

function addAmounts() { return this[0].balance().add(this[1].amount()); }

/*
function Transaction(data, lastTxn) {
  ko.mapping.fromJS(JSON.parse(data), {
    include: ['id', 'date', 'amount', 'description'],
    ignore: ['balance'],
    //key: function(data) { return ko.utils.unwrapObservable(data.id) },
    'amount': {
      create: function(options) {
        return ko.observable(new dblbook.Balance(options.data));
      },
      //update: function(options) {
      //  return options.data.toString();
      //},
    },
  }, this);
  this.balance = lastTxn ? ko.computed(addAmounts, [lastTxn, this]) : this.amount;
}*/

/**
 * The same register can be shared between multiple accounts, so we have a
 * container object cache and vend these registers.
 *
 * @constructor
 */
/*
function RegisterCache() {
  this.registers = {};
}

RegisterCache.prototype.get = function(id) {
  if (!this.registers[id]) {
    var data = localStorage.getItem(id);
    var register = ko.observableArray();
    if (data) {
      var txn = null;
      data.split("\n").forEach(function(line) {
        register.push(txn = new Transaction(line, txn));
      });
    }
    registers[id] = register;
  }
  return registers[id];
}

var registers = new RegisterCache;

function Account(data) {
  ko.mapping.fromJS(data || {id: guid(), name: "New Account"}, {
    include: ['id', 'name', 'real'],
    ignore: ['balance'],
    //key: function(data) { return ko.utils.unwrapObservable(data.id); },
  }, this);

  // Load the register for this account.
  this.register = registers.get(this.id());
  this.balance = ko.computed(function() {
    var reg = this.register() || [];
    return reg.length > 0 ? reg.last().balance() : new dblbook.Balance();
  }, this);
  this.editing = ko.observable(false);
  this.open = ko.observable(false);
  this.group = ko.observable(false);
}

function onKeyUp(data, event) {
  console.log(this);
  if (event.keyCode == '13')
    this.editing(false);
}

function Entity(data) {
  ko.mapping.fromJS(data, {
    include: ['name', 'accounts'],
    'accounts': {
      create: function(options) { return new Account(options.data); },
    },
  }, this);

  // // Load the ledger for this entity.
  // var ledger = loadLedger(id);
  // options.parent.ledger = ledger;
  // return ko.mapping.fromJS(id);

  // An entity's net worth is the sum of the balances of its real accounts.
  this.netWorth = ko.computed(function() {
    var ret = this.accounts().reduce(function(sum, acct) {
      return acct.real ? sum.add(acct.balance()) : sum;
    }, new dblbook.Balance());
    return ret;
  }, this);
  this.url = "#entity/" + this.id()
  this.accounts.sort(function(a, b) { return strcmp(a, b); });
}

function Config(data) {
  ko.mapping.fromJS(data, {
    include: ['entities'],
    'entities': {
      create: function(options) { return new Entity(options.data); }
    },
  }, this)
}

var config = new Config(JSON.parse(localStorage.getItem("config")));
//var breadcrumbs = ko.observableArray();
//ko.applyBindings({"breadcrumbs": breadcrumbs}, $("#nav").get(0));

var content = ko.observable();
*/

var dblbookControllers = angular.module('dblbookControllers', []);

dblbookControllers.controller('HomeCtrl', ['$scope',
  function ($scope) {
    $scope.entities = [
      {"id": "entity1", "name": "Yo My Entity 1", "netWorth": "$5"},
      {"id": "entity1", "name": "Yo My Entity 1", "netWorth": "$105"},
      {"id": "entity1", "name": "Yo My Entity 1", "netWorth": "$0"},
      {"id": "entity1", "name": "Yo My Entity 1", "netWorth": "$111"},
      {"id": "entity1", "name": "Yo My Entity 1", "netWorth": "$34"},
      {"id": "entity1", "name": "Yo My Entity 1", "netWorth": "$5"},
      {"id": "entity1", "name": "Yo My Entity 1", "netWorth": "$5"},
      {"id": "entity1", "name": "Yo My Entity 1", "netWorth": "$5"}
    ];
  }]);

dblbookControllers.controller('EntityCtrl', ['$scope', '$routeParams',
  function($scope, $routeParams) {
    $scope.entityId = $routeParams.id;
    $scope.editing = false;
    $scope.subpage = "accounts";

    $scope.edit = function() {
      $scope.editing = true;
    }

    $scope.finishEdit = function() {
      $scope.editing = false;
    }
  }]);

var dblbookApp = angular.module('dblbookApp', [
  'ngRoute',
  'dblbookControllers',
  'ui.bootstrap'
]);

dblbookApp.config(['$routeProvider',
  function($routeProvider) {
    $routeProvider.
      when('/entity/:id', {
        templateUrl: 'entity.html',
      }).
      otherwise({
        templateUrl: 'home.html',
      });
  }]);

dblbookApp.directive("applink", ['$location',
  function ($location) {
    return {
      link: function (scope, element, attrs) {
        element.bind("click", function () {
          scope.$apply($location.path(attrs.applink))
        });
      }
    }
  }]);
