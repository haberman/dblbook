
import * as dblbook from 'dblbook';
import * as React from 'react';
import * as model from 'model';
import { DefaultRoute, Link, Route, RouteHandler, NotFoundRoute } from 'react-router';
import * as ReactRouter from 'react-router';

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
    <Route name="account" path="/accounts/:guid" handler={dblbook.Account}/>
    <DefaultRoute name="accounts" handler={dblbook.AccountPage}/>
    <NotFoundRoute handler={dblbook.NotFound}/>
  </Route>
);

// Load the global database, then display the initial route once it's loaded.
model.DB.open().then(function(db) {
  // Gnucash importer doesn't yet have a proper way to get this.
  document.db = db;

  ReactRouter.run(routes, function(Handler) {
    React.render(<Handler db={db} />, document.body);
  });
});

/*
chrome.identity.getAuthToken({interactive: true}, function(token) {
  console.log("Got token: ", token);
});
*/
