/**
 * Copyright 2015 Kitware Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/* global module, require */

module.exports = function (grunt) {
    var path = require('path');

    var defaultTasks = [
        'stylus', 'build-js', 'copy:static', 'docs', 'copy:docs'
    ];

    // Pass a "--env=<value>" argument to grunt. Default value is "dev".
    var environment = grunt.option('env') || 'dev';

    // Returns a json string containing information from the current git repository.
    var versionInfoObject = function () {
        var gitVersion = grunt.config.get('gitinfo');
        var local = gitVersion.local || {};
        var branch = local.branch || {};
        var current = branch.current || {};
        return JSON.stringify(
            {
                git: !!current.SHA,
                SHA: current.SHA,
                shortSHA: current.shortSHA,
                date: grunt.template.date(new Date(), 'isoDateTime', true),
                apiVersion: grunt.config.get('pkg').version,
                describe: gitVersionObject
            },
            null,
            '  '
        );
    };

    /* Ideally, we would add version information for each library we use to
     * this object. */
    var libVersionInfoObject = function () {
        return JSON.stringify({
            date: grunt.template.date(new Date(), 'isoDateTime', true),
            geojsVersion: geojsVersionObject
        }, null, '  ');
    };
    var geojsVersionObject, gitVersionObject;

    // Project configuration.
    grunt.config.init({
        pkg: grunt.file.readJSON('package.json'),

        jade: {
            options: {
                client: true,
                compileDebug: false,
                namespace: 'geoapp.templates',
                processName: function (filename) {
                    return path.basename(filename, '.jade');
                }
            },
            core: {
                files: {
                    'built/templates.js': [
                        'client/templates/**/*.jade'
                    ]
                }
            }
        },

        copy: {
            static: {
                expand: true,
                cwd: 'client/static',
                src: ['**/*'],
                dest: 'built'
            },
            docs: {
                expand: true,
                cwd: 'docs/_build/html',
                src: ['**/*'],
                dest: 'built/docs'
            },
            libs: {
                expand: true,
                cwd: 'node_modules/bootstrap/dist/fonts',
                src: ['**/*'],
                dest: 'built/lib/bootstrap/fonts'
            },
            optional: {
                expand: true,
                cwd: 'client/optional/static',
                src: [
                    '**/*.js',
                    '**/*.json',
                    '**/*.png'
                ],
                dest: 'built'
            }
        },

        stylus: {
            core: {
                files: {
                    'built/app.min.css': [
                        'client/stylesheets/**/*.styl',
                        '!client/stylesheets/apidocs/*.styl'
                    ]
                }
            }
        },

        cssmin: {
            libs: {
                files: {
                    'built/libs.min.css': [
                        /* c3 */
                        'node_modules/c3/c3.css',
                        /* daterangepicker */
                        'node_modules/daterangepicker/daterangepicker-bs3.css',
                        /* bootstrap-slider */
                        'node_modules/bootstrap-slider/dist/css/bootstrap-slider.css',
                        /* bootstrap-combobox */
                        'client/lib/bootstrap-combobox.css'
                    ]
                }
            }
        },

        shell: {
            sphinx: {
                command: [
                    'cd docs',
                    'make html'
                ].join('&&'),
                options: {
                    stdout: true
                }
            },
            'sphinx-clean': {
                command: [
                    'cd docs',
                    'make clean'
                ].join('&&'),
                options: {
                    stdout: true
                }
            },
            getgitversion: {
                command: 'git describe --always --long --dirty --all',
                options: {
                    callback: function (err, stdout, stderr, callback) {
                        gitVersionObject = stdout.replace(/^\s+|\s+$/g, '');
                        callback();
                    }
                }
            },
            getgeojsversion: {
                command: 'git --git-dir=geojs/.git describe --always --long --dirty --all',
                options: {
                    callback: function (err, stdout, stderr, callback) {
                        geojsVersionObject = stdout.replace(/^\s+|\s+$/g, '');
                        callback();
                    }
                }
            }
        },

        concat: {
            options: {
                separator: ';',
                sourceMap: true
            },
            app: {
                src: [
                    /* main.js must be first */
                    'client/js/main.js',
                    'built/templates.js',
                    'built/geoapp-version.js',
                    /* Make sure the base files get included before the
                     * dependent files. */
                    'client/js/graph.js',
                    'client/js/layers.js',
                    'client/js/**/*.js'
                ],
                dest: 'built/app.js'
            }
        },

        'string-replace': {
            libs: {
                /* There is an bug in c3 that fails to expose the internal Axis
                 * class.  This works around it. */
                files: {
                    'built/c3.js': [
                        'node_modules/c3/c3.js'
                    ]
                },
                options: {
                    replacements: [{
                        pattern: /(}[^}]*)$/,
                        replacement: '    c3_chart_internal_axis_fn = c3.chart.internal.axis.fn = Axis.prototype;\n$1'
                    }]
                }
            }
        },

        uglify: {
            options: {
                sourceMap: environment === 'dev',
                sourceMapIncludeSources: true,
                report: 'min',
                beautify: {
                    ascii_only: true
                }
            },
            app: {
                options: {
                    sourceMapIn: 'built/app.js.map'
                },
                files: {
                    'built/app.min.js': [
                        'built/app.js'
                    ]
                }
            },
            libsfirst: {
                files: {
                    'built/libs.first.min.js': [
                        'node_modules/d3/d3.js'
                    ]
                }
            },
            libs: {
                files: {
                    'built/libs.min.js': [
                        /* d3 is included from Girder.  We need c3 */
                        'built/c3.js',
                        /* These items are from geojs, but we exclude jquery */
                        'geojs/bower_components/gl-matrix/dist/gl-matrix.js',
                        'geojs/bower_components/proj4/dist/proj4-src.js',
                        'geojs/node_modules/pnltri/pnltri.js',
                        'geojs/dist/built/geo.js',
                        /* daterangepicker */
                        'node_modules/moment/moment.js',
                        'node_modules/daterangepicker/daterangepicker.js',
                        /* bootstrap-slider */
                        'node_modules/bootstrap-slider/js/bootstrap-slider.js',
                        /* bootstrap-combobox - downloaded from
                         * https://github.com/RLHawk1/bootstrap-combobox,
                         * because the official bower repositiory is lacking
                         * the critical feature of allowing free-text
                         * values. */
                        'client/lib/bootstrap-combobox.js',
                        /* Our version record */
                        'built/geoapplib-version.js',
                        /* Sortable */
                        'node_modules/sortablejs/Sortable.js',
                        'node_modules/sortablejs/jquery.binding.js',
                        /* hammerjs */
                        'node_modules/hammerjs/hammer.js'
                    ],
                    'built/optional.min.js': [
                        /* optional libraries */
                        'client/optional/js/**/*.js'
                    ],
                    'built/testing.min.js': [
                        /*
                        'clients/web/test/lib/jasmine-1.3.1/jasmine.js',
                        'node_modules/blanket/dist/jasmine/blanket_jasmine.js',
                        'clients/web/test/lib/jasmine-1.3.1/ConsoleReporter.js'
                        */
                    ]
                }
            }
        },

        watch: {
            stylus_core: {
                files: ['client/stylesheets/**/*.styl'],
                tasks: ['stylus:core']
            },
            js_core: {
                files: ['clients/js/**/*.js'],
                tasks: ['uglify:app']
            },
            jade_core: {
                files: ['client/templates/**/*.jade'],
                tasks: ['build-js']
            },
            sphinx: {
                files: ['docs/*.rst'],
                tasks: ['docs']
            }
        },

        'file-creator': {
            app: {
                'built/geoapp-version.js': function (fs, fd, done) {
                    var geoappVersion = versionInfoObject();
                    fs.writeSync(
                        fd,
                        [
                            '/* global geoapp: true */',
                            '/* jshint ignore: start */',
                            '//jscs:disable',
                            'var girderVersionInfo = geoapp.versionInfo;',
                            'geoapp.versionInfo = ',
                            geoappVersion,
                            ';',
                            'geoapp.versionInfo.girderVersion = girderVersionInfo;',
                            'geoapp.versionInfo.libVersion = libVersionInfo;',
                            '/* jshint ignore: end */',
                            '//jscs:enable\n'
                        ].join('\n')
                    );
                    done();
                }
            },
            libs: {
                'built/geoapplib-version.js': function (fs, fd, done) {
                    var geoappLibVersion = libVersionInfoObject();
                    fs.writeSync(
                        fd,
                        [
                            '/* global geoapp: true */',
                            '/* jshint ignore: start */',
                            '//jscs:disable',
                            'window.libVersionInfo = ',
                            geoappLibVersion,
                            ';',
                            '/* jshint ignore: end */',
                            '//jscs:enable\n'
                        ].join('\n')
                    );
                    done();
                }
            }
        }
    });

    if (['dev', 'prod'].indexOf(environment) === -1) {
        grunt.fatal('The "env" argument must be either "dev" or "prod".');
    }

    grunt.loadNpmTasks('grunt-contrib-compress');
    grunt.loadNpmTasks('grunt-contrib-concat');
    grunt.loadNpmTasks('grunt-contrib-copy');
    grunt.loadNpmTasks('grunt-contrib-cssmin');
    grunt.loadNpmTasks('grunt-contrib-jade');
    grunt.loadNpmTasks('grunt-contrib-stylus');
    grunt.loadNpmTasks('grunt-contrib-uglify');
    grunt.loadNpmTasks('grunt-contrib-watch');
    grunt.loadNpmTasks('grunt-file-creator');
    grunt.loadNpmTasks('grunt-gitinfo');
    grunt.loadNpmTasks('grunt-shell');
    grunt.loadNpmTasks('grunt-string-replace');

    grunt.registerTask('version-info', [
        'gitinfo',
        'shell:getgitversion',
        'file-creator:app'
    ]);

    grunt.registerTask('libversion-info', [
        'shell:getgeojsversion',
        'file-creator:libs'
    ]);

    grunt.registerTask('build-js', [
        'jade',
        'version-info',
        'concat:app',
        'uglify:app'
    ]);
    grunt.registerTask('init', [
        'libversion-info',
        'string-replace:libs',
        'uglify:libsfirst',
        'uglify:libs',
        'cssmin:libs',
        'copy:libs',
        'copy:optional'
    ]);
    grunt.registerTask('docs-clean', ['shell:sphinx-clean']);
    grunt.registerTask('docs', ['shell:sphinx']);
    grunt.registerTask('default', defaultTasks);
};
