
import * as dblbook from 'dblbook';
import * as React from 'react';
import * as ReactDOM from 'react-dom';
import * as model from 'model';
import { DefaultRoute, Link, Route, Router, RouteHandler, NotFoundRoute } from 'react-router';

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

// Load the global database, then display the initial route once it's loaded.
model.DB.open().then(function(db) {
  // Gnucash importer doesn't yet have a proper way to get this.
  document.db = db;

  var routes = (
    <Route handler={App}>
      <Route path="/accounts/:guid" db={db} component={dblbook.Account}/>
      <Route path="/" component={dblbook.AccountPage}/>
      <Route path="*" component={dblbook.NotFound}/>
    </Route>
  );

  ReactDOM.render(<Router>{routes}</Router>, document.body);
});

/*
chrome.identity.getAuthToken({interactive: true}, function(token) {
  console.log("Got token: ", token);
});
*/
