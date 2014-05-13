
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

angular.module('dblbookControllers', [])
  .controller('HomeCtrl', ['$scope',
    function ($scope) {
      $scope.entities = [
        {"id": "entity1", "name": "Yo My Entity 1", "netWorth": "$5"},
        {"id": "entity1", "name": "Yo My Entity 1", "netWorth": "$105"},
        {"id": "entity1", "name": "Yo My Entity 1", "netWorth": "$0"},
        {"id": "entity1", "name": "Yo My Entity 1", "netWorth": "$111"},
        {"id": "entity1", "name": "Yo My Entity 1", "netWorth": "$34"},
        {"id": "entity1", "name": "Yo My Entity 7", "netWorth": "$5"},
        {"id": "entity1", "name": "Yo My Entity 1", "netWorth": "$5"},
        {"id": "entity1", "name": "Yo My Entity 1", "netWorth": "$5"}
      ];
    }])

  .controller('EntityCtrl', ['$scope', '$routeParams',
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

angular.module('dblbookApp', [
    'ngRoute',
    'dblbookControllers',
    'ui.bootstrap'])

  .config(['$routeProvider',
    function($routeProvider) {
      $routeProvider.
        when('/entity/:id', {
          templateUrl: 'entity.html',
        }).
        otherwise({
          templateUrl: 'home.html',
        });
    }])

  .directive("applink", ['$location',
    function ($location) {
      return {
        link: function (scope, element, attrs) {
          element.bind("click", function () {
            scope.$apply($location.path(attrs.applink))
          });
        }
      }
    }]);
