
var gulp = require("gulp");
var gutil = require("gulp-util");
var webpack = require("webpack");
//var WebpackDevServer = require("webpack-dev-server");

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
            {
              test: /\.css$/,
              loader: 'file'
            }
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
    // Uncomment to uglify.
    //plugins: [
    //  new webpack.optimize.UglifyJsPlugin({minimize: true})
    //],
};

gulp.task("default", function(callback) {
    // run webpack
    webpack(webpackConfig,
      function(err, stats) {
        if(err) throw new gutil.PluginError("webpack", err);
        gutil.log("[webpack]", stats.toString({
            // output options
        }));
        callback();
    });

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
