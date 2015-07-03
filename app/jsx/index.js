
var DefaultRoute = ReactRouter.DefaultRoute;
var Link = ReactRouter.Link;
var Route = ReactRouter.Route;
var RouteHandler = ReactRouter.RouteHandler;
var NotFoundRoute = ReactRouter.NotFoundRoute;

var App = React.createClass({
  render: function () {
    return <div id="top">
      <h1>Feline Funds</h1>
      <div>
        <ul>
          <Link to="accounts">Accounts</Link>
        </ul>
      </div>

      <div>
        {/* Render sub-component for this route. */}
        <RouteHandler db={this.props.db}/>
      </div>
    </div>
  }
});

var routes = (
  <Route handler={App}>
    <Route name="account" path="/accounts/:guid" handler={Account}/>
    <DefaultRoute name="accounts" handler={AccountPage}/>
    <NotFoundRoute handler={NotFound}/>
  </Route>
);

// Load the global database, then display the initial route once it's loaded.
dataModel.DB.open().then(function(db) {
  // Gnucash importer doesn't yet have a proper way to get this.
  document.db = db;

  ReactRouter.run(routes, function(Handler) {
    React.render(<Handler db={db} />, document.body);
  });
});

React.addons.batchedUpdates(function() {
  console.log("Maybe this works after all!");
});

/*
chrome.identity.getAuthToken({interactive: true}, function(token) {
  console.log("Got token: ", token);
});
*/
