
var gulp = require("gulp");
var gutil = require("gulp-util");
var webpack = require('webpack');
var gulpWebpack = require('gulp-webpack');
var execFile = require('child_process').execFile;
var flow = require('flow-bin');

gulp.task('default', ['flow:check', 'copy'], function() {
  doWebpack(webpackProdConfig);
});

gulp.task('dev', ['flow:start'], function() {
  doWebpack(webpackDevConfig);
  gulp.watch(['app/**/*.jsx?', 'model/**/*.js', 'tests/tests.js'],
             ['flow:status']);
  // TODO: watch files for copy task.
});

gulp.task('copy', function() {
  gulp.src([
    'bower_components/pure/pure-min.css',])
    .pipe(gulp.dest('build'));

  // TODO: Clean this up, the entire tree of SASS etc. isn't required
  // in the output
  gulp.src('bower_components/fontawesome/**/*')
    .pipe(gulp.dest('build/fontawesome'));

  gulp.src('app/*.html')
    .pipe(gulp.dest('build'));

  gulp.src('app/*.css')
    .pipe(gulp.dest('build'));
});

gulp.task('typecheck', function(callback) {
  runFlow(['start'], function() {
    runFlow(['status', '--no-auto-start'], callback);
  })
});

gulp.task('flow:status', function(callback) {
  runFlow(['status', '--no-auto-start'], callback);
});

gulp.task('flow:check', function(callback) {
  runFlow(['check'], callback);
})

gulp.task('flow:start', function(callback) {
  runFlow(['start'], callback);
});

gulp.task('flow:stop', function(callback) {
  runFlow(['stop'], callback);
})

function runFlow(cmd, callback) {
  execFile(flow, cmd, {
    cwd: module.__dirname
  }, function(err, stdout, stderr) {
    if (err && stdout.length > 0) {
      callback(new gutil.PluginError('flow', stdout));
    }
    else if (err) {
      callback(err);
    }
    else {
      callback();
    }
  });
}

var webpackConfig = {
  entry: {
    'tests/tests-bundle.js': './tests/tests.js',
    'build/bundle.js': './app/jsx/index.js',
  },
  output: {
    path: __dirname,
    filename: '[name]'
  },
  module: {
    loaders: [
      {
        test: /\.jsx?$/,
        exclude: [/bower_components/, /node_modules/],
        loader: 'babel-loader'
      },
    ]
  },
  resolve: {
    modulesDirectories: [
      'model',
      'bower_components/qunit/qunit',
      'node_modules',
      'app/jsx',
    ]
  },
  devtool: "#inline-source-map",
  noInfo: true
};

var webpackDevConfig = {
  watch: true,
  debug: true,
};

var webpackProdConfig = {
  plugins: [
    new webpack.DefinePlugin({
      'process.env': {
        'NODE_ENV': '"production"'
      }
    }),
    new webpack.optimize.DedupePlugin(),
    //new webpack.optimize.UglifyJsPlugin({minimize: true}),
    new webpack.optimize.UglifyJsPlugin({ compress: { warnings: false } }),
  ]
}

function merge(obj1, obj2) {
  var ret = {};
  for (var attrname in obj1) { ret[attrname] = obj1[attrname]; }
  for (var attrname in obj2) { ret[attrname] = obj2[attrname]; }
  return ret;
}

function doWebpack(opts) {
  return gulp.src(['app/jsx/index.js', 'tests/tests.js'])
    .pipe(gulpWebpack(merge(webpackConfig, opts), webpack))
    .pipe(gulp.dest('.'));
}
