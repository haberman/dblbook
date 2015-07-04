
# Double-Booked: A reactive web app for double-entry accounting

This is an app for double-entry accounting, in the tradition
of [GnuCash](http://www.gnucash.org/) and
[Ledger](http://www.ledger-cli.org/).  It is designed in a
reactive style, with the goal of having a highly responsive
UI where updates propagate immediately and you don't
"generate a report", you just view it (with instant
results).

It is designed to run in a web browser, client side, using
indexedDB as its data store (though with the ability to sync
to a centralized server).

I have lots of big ideas for how I want to improve on
existing accounting apps.  But as a backend guy, I am
primarily focused right now on creating a data storage layer
that has all the features I want.  I want to make sure the
data model is rich and powerful (hierarchical accounts,
multiple currencies, stocks/bonds with lot/basis info,
balance assertions), but also highly efficient.  Propagating
updates efficiently in an accounting ledger is a hard
problem that I discuss at length in
[DBDesign.md](DBDesign.md).

Basically I'm trying to create the "git" of double-entry
accounting.  Git's primary contribution is its efficient
data model and storage format.  It is the basis on which the
entire ecosystem is built.

# Build / Run / Test

You need [Node.js](https://nodejs.org/).

Install these tools if you don't have them globally
installed already:

    $ npm install -g bower
    $ npm install -g gulp

Then install our dependencies into the local tree (it reads
the list of packages to install from `bower.json` and
`package.json`):

    $ bower install
    $ npm install

Now build/transpile all the source and create a
fully-populated output directory in `build/`:

    $ gulp

Now you can run the app by visiting `build/index.html`
(not much to see right now though).

To run the tests visit `tests/test.html`.  I have verified
they work in both Chrome 43 and Firefox 39.

# Overall Design / Technologies

The data storage layer is in [model](model) and written in
ES6.  It only depends on:

* a red-black tree, since JavaScript doesn't natively
  provide a sorted map.
* indexedDB, for storing the data locally

Because of the second dependency, it requires a web browser
(there doesn't appear to be a robust implementation of
indexedDB for Node.js).

The storage layer is by far the most interesting and mature
part of the project so far.  Between the [design
doc](DBDesign.md) and the source comments, it should be
pretty usable.  It is also tested reasonably well by the
tests in `tests`.

The (very minimal) UI is built on
[React](http://facebook.github.io/react/) and
[ReactRouter](https://github.com/rackt/react-router).  It
uses some minimal UI framework in the form of
[Pure](http://purecss.io/) and
[FontAwesome](http://fortawesome.github.io/Font-Awesome/).

Since the app is designed to be capable of working
completely offline, it is intended to be usable as a Chrome
App or with ServiceWorker.  I'm keeping my options open on
this point.

My hope is to implement syncing with a server using a flat
file on Google Drive or DropBox.  So you'd have a local
database in indexedDB, but you could push your commit log to
Google Drive and pull commits from it.  A key idea here is
that it should sync to storage owned and controlled by the
user, not servers that I operate.
