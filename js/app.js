(function () {
  "use strict";

  var gprs = angular.module('gprs', []);

  var user = null; // Your username
  var token = null; // Your generated personal access token
  var hostBase = 'https://github.com'
  var apiBase = 'https://api.github.com';
  var loggedin = false;

  if (localStorage.gprs_user && localStorage.gprs_token) {
    user = localStorage.gprs_user;
    token = localStorage.gprs_token;
    loggedin = true;
  }

  gprs.run(['$http', function ($http) {
    $http.defaults.headers.common['Authorization'] = 'token ' + token;
  }]);

  gprs.directive('prTable', function () {
    return {
      restrict: 'E',
      templateUrl: 'template/pr-table.html',
      scope: {
        prs: '=prs',
        filter: '=filter'
      }
    };
  });

  gprs.controller('UserCtrl', ['$scope', '$http', function ($scope, $http) {
    if (!user) {
      // Try to guess the username
      $http.get(hostBase).then(function (res) {
        var gh_user = res.headers()['x-github-user'];
        if (gh_user) {
          $scope.user = gh_user;
        }
      });
    }

    $scope.loggedin = loggedin;
    $scope.user = user;
    $scope.token = token;
    $scope.login = function () {
      localStorage.gprs_user = $scope.user;
      localStorage.gprs_token = $scope.token;
      window.location.reload();
    }
    $scope.logout = function () {
      localStorage.removeItem('gprs_user');
      localStorage.removeItem('gprs_token');
      loggedin = false;
      window.location.reload();
    }
  }]);

  gprs.controller('TitleCtrl', ['$scope', function ($scope) {
    if (user) {
      $scope.user = user;
    }
  }]);

  gprs.controller('PullRequestsCtrl', ['$scope', '$filter', '$http', function ($scope, $filter, $http) {
    $scope.loggedin = loggedin;
    $scope.user = user;

    $scope.prs = [];

    $scope.outgoingPRFilter = function (pr) {
      return pr.pull.user.login == user;
    };
    $scope.incomingSelfPRFilter = function (pr) {
      return pr.pull.user.login != user && pr.mentioned;
    };
    $scope.incomingPRFilter = function (pr) {
      return pr.pull.user.login != user && !pr.mentioned;
    };

    var orderBy = $filter('orderBy');
    $scope.order = function (predicate, reverse) {
      $scope.prs = orderBy($scope.prs, predicate, reverse);
    };
    $scope.order('-pull.updated_at', false);

    $scope.merge = function (pr) {
      var url = pr.pull._links.merge.href;
      var msg = pr.pull.title;

      $http.put(url, {'commit_message': msg}).
        success(function (data, status, headers, config) {
          console.debug([data, status, headers, config]);
          alert('Successfully Merged!');
          for (var i=0; i < $scope.prs.length; i++) {
            if ($scope.prs[i].pull.id == pr.pull.id) {
              $scope.prs[i].state = 'merged';
              return;
            }
          }
        }).
        error(function (data, status, headers, config) {
          console.debug([data, status, headers, config]);
          alert('Merge failed!\n' + status + ': ' +data);
        });
    };

    var iterate = function (promise, cont, done) {
      promise.success(function (data, status, headers) {
        for (var i = 0; i < data.length; i++) {
          cont(data[i]);
        }
        var link = headers('Link');

        if (link) {
          var m = link.match(/<([^>]+)>; rel="next"/);

          if (m) {
            iterate($http.get(m[1]), cont, done);
          } else if (done) {
            done();
          }
        } else if (done) {
          done();
        }
      });
    };

    var getCommentsForPR = function (pr, cont, done) {
      iterate($http.get(pr._links.comments.href), cont, done);
    };

    var getStatusForPR = function (pr, done) {
      if (!pr._links.statuses) {
        done('none');
      } else {
        $http.get(pr._links.statuses.href).then(function (status) {
          if (status.data.length == 0) {
            done('empty');
          } else {
            done(status.data[0].state);
          }
        });
      }
    }

    var getPRsForRepo = function (repo, cont, done) {
      var url = apiBase + '/repos/' + repo.owner.login + '/' + repo.name + '/pulls?sort=updated&direction=desc';
      iterate($http.get(url), cont, done);
    };

    var getReposForUser = function (user, cont, done) {
      var url = apiBase + '/user/subscriptions';
      iterate($http.get(url), cont, done);
    };

    // Courtesy http://stackoverflow.com/a/12213072
    var DateFormatter = function () {
      this.dateMarkers = {
        d: ['getDate',        function (v) { return ("0"+v).substr(-2,2); }],
        m: ['getMonth',       function (v) { return ("0"+ ++v).substr(-2,2); }],
        n: ['getMonth',       function (v) { return ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][v]; }],
        w: ['getDay',         function (v) { return ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][v]; }],
        y: ['getFullYear'],
        H: ['getHours',       function (v) { return ("0"+v).substr(-2,2); }],
        M: ['getMinutes',     function (v) { return ("0"+v).substr(-2,2); }],
        S: ['getSeconds',     function (v) { return ("0"+v).substr(-2,2); }],
        i: ['toISOString',    null],
        l: ['toLocaleString', null]
      };

      this.format = function (date, fmt) {
        var dateMarkers = this.dateMarkers;
        var dateTxt = fmt.replace(/%(.)/g, function (m, p) {
          var rv = date[(dateMarkers[p])[0]]();

          if (dateMarkers[p][1] != null) {
            rv = dateMarkers[p][1](rv);
          }

          return rv;
        });

        return dateTxt;
      };
    };

    var addPR = function (repo, pr, mentioned, score, state) {
      pr.updated_at = new DateFormatter().format(new Date(pr.created_at), "%y-%m-%d %H:%M");
      pr._links.merge = {'href': pr._links.self.href + '/merge'};

      var data = {
        repo: repo,
        pull: pr,
        mentioned: mentioned,
        score: score,
        state: state
      };

      $scope.prs.push(data);
      $scope.order('-pull.updated_at', false);
    };

    var userIsMentioned = function (body) {
      return body ? body.indexOf('@' + user) >= 0 : 0;
    };

    var countMinusOne = function (body) {
      var match = body.match(/:-1:/g);

      return match ? match.length : 0;
    };

    var countPlusOne = function (body) {
      var match = body.match(/:\+1:|LGTM/ig);

      return match ? match.length : 0;
    };

    getReposForUser(user, function (repo) {
      getPRsForRepo(repo, function (pr) {
        var mentioned = userIsMentioned(pr.body);
        var score = 0;

        getStatusForPR(pr, function (status) {
          getCommentsForPR(pr, function (comment) {
            mentioned = mentioned || userIsMentioned(comment.body);
            score += countPlusOne(comment.body);
            score -= countMinusOne(comment.body);
          }, function () {
            addPR(repo, pr, mentioned, score, status);
          });
        });
      });
    });
  }]);
})();
