#!/usr/bin/env python
# -*- coding: utf-8 -*-

###############################################################################
#  Copyright 2015 Kitware Inc.
#
#  Licensed under the Apache License, Version 2.0 ( the "License" );
#  you may not use this file except in compliance with the License.
#  You may obtain a copy of the License at
#
#    http://www.apache.org/licenses/LICENSE-2.0
#
#  Unless required by applicable law or agreed to in writing, software
#  distributed under the License is distributed on an "AS IS" BASIS,
#  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
#  See the License for the specific language governing permissions and
#  limitations under the License.
###############################################################################

import cgi
import cherrypy
import girder.utility.config
import girder.utility.server
import json
import mako.template
import os
import sys
import xml.sax.saxutils
from girder import logger

import geoapp

PACKAGE_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.dirname(PACKAGE_DIR)

origLoadConfig = None


class GeoAppRoot(object):
    """
    Serve the root webpage for our application.
    """
    exposed = True
    indexHtml = None
    vars = {
        'apiRoot': 'api/v1',
        'staticRoot': 'built',
        'girderRoot': 'girder/static',
        'appTitle': 'Minerva Taxi',
        'appIcon': 'icon.png',
        'iniSettings': ''
    }

    def GET(self, *args, **kwargs):
        config = girder.utility.config.getConfig()
        vars = self.vars
        for key in ('appTitle', 'appIcon'):
            if config.get('application', {}).get(key):
                vars[key] = config['application'][key]
        iniList = {}
        iniList.update(config.get('resources', {}))
        sectionList = {
            'controls': 'defaultControls',
            'places': 'placeControls',
            'regions': 'regionControls'
        }
        for key in sectionList:
            if key in config:
                iniList[sectionList[key]] = json.dumps(config[key])
        for key in iniList:
            val = iniList[key]
            if not isinstance(val, basestring):
                val = json.dumps(val)
            vars['iniSettings'] += '%s=\'%s\' ' % (
                key, xml.sax.saxutils.escape(val, {
                    '"': '&quot;', '\'': '&apos;'}))
        datasets = {'taxidata': True, 'instagramdata': True}
        datasets.update(config.get('datasets', {}))
        datasrcList = [key for key in datasets if datasets[key]]
        data = {}
        for dbtype in datasrcList:
            datalist = []
            for key in config.get(dbtype, {}):
                db = config[dbtype][key]
                if not isinstance(db, dict) or 'class' not in db:
                    continue
                datalist.append((db.get('order', sys.maxint),
                                 db.get('name', ''), key, db))
            datalist.sort()
            data[dbtype] = [{
                'key': key,
                'name': name,
                'access': str(dbdict.get('access', '')),
                'poll': str(dbdict.get('poll', ''))
            } for (order, name, key, dbdict) in datalist]
        datastr = []
        for category in data:
            datastr.extend(['<', category, '>'])
            for elem in data[category]:
                datastr.append('<option')
                for key in elem:
                    datastr.extend([' ', key, '="',
                                    cgi.escape(elem[key], quote=True), '"'])
                datastr.append('/>')
            datastr.extend(['</', category, '>'])
        vars['data'] = ''.join(datastr)
        if self.indexHtml is None:
            page = open(os.path.join(ROOT_DIR, 'built/index.html')).read()
            self.indexHtml = mako.template.Template(page).render(**vars)
        return self.indexHtml


class GeoApp():
    def __del__(self):
        cherrypy.engine.exit()

    def __init__(self):
        # If the config was already loaded, make sure we reload using our app's
        # added files.
        loadConfig()
        # Use our logger values, not girder's
        logConfig = girder.utility.config.getConfig().get('logging', {})
        if 'log_root' in logConfig:
            logConfig['log_root'] = os.path.expanduser(logConfig['log_root'])
        for hdlr in logger.handlers[:]:
            logger.removeHandler(hdlr)
        girder._setupLogger()
        logger.info('Minerva Taxi starting')

    """Start the server and serve until stopped."""
    def start(self, block=True):
        cherrypy.engine.timeout_monitor.unsubscribe()
        self.root = GeoAppRoot()
        # Create the girder services and place them at /girder
        self.root.girder, appconf = girder.utility.server.configureServer()
        curConfig = girder.utility.config.getConfig()
        localappconf = {
            '/built': {
                'tools.staticdir.on': 'True',
                'tools.staticdir.dir': os.path.join(ROOT_DIR, 'built')
            },
            '/girder/static': curConfig['/static'],
            '/girder/static/lib/bootstrap/fonts': {
                'tools.staticdir.on': 'True',
                'tools.staticdir.dir': os.path.join(
                    ROOT_DIR, 'built/lib/bootstrap/fonts')
            }
        }
        appconf.update(localappconf)
        appconf['/']['tools.trailing_slash.on'] = False
        curConfig.update(localappconf)

        self.server = cherrypy.tree.mount(self.root, '/', appconf)
        # move the girder API from /girder/api to /api
        self.root.api = self.root.girder.api
        del self.root.girder.api

        # The specified path here is relative to the /api path
        self.root.girder.updateHtmlVars({'staticRoot': '../girder/static'})
        self.root.api.v1.updateHtmlVars({'staticRoot': '../girder/static'})

        info = {
            'config': appconf,
            'serverRoot': self.root,
            'apiRoot': self.root.api.v1
        }
        # load plugin is called with plugin, root, appconf, root.api.v1 as
        #   apiRoot, curConfig
        # the plugin module is then called with info = {name: plugin,
        #   config: appconf, serverRoot: root, apiRoot: root.api.v1,
        #   pluginRootDir: (root)}
        # it can modify root, appconf, and apiRoot

        geoapp.load(info)

        cherrypy.engine.start()
        if block:
            cherrypy.engine.block()


def loadConfig():
    """
    Load the girder configuration, then update it with our configuration.
    """
    origLoadConfig()
    configPaths = []
    configPaths.append(
        os.path.join(ROOT_DIR, 'conf', 'geoapp.dist.cfg'))
    configPaths.append(
        os.path.join(ROOT_DIR, 'conf', 'geoapp.local.cfg'))
    configPaths.append(
        os.path.join('/etc', 'geoapp.cfg'))
    configPaths.append(
        os.path.join(os.path.expanduser('~'), '.geoapp', 'geoapp.cfg'))
    if 'GEOAPP_CONFIG' in os.environ:
        configPaths.append(os.environ['GEOAPP_CONFIG'])

    for curConfigPath in configPaths:
        if os.path.exists(curConfigPath):
            girder.utility.config._mergeConfig(curConfigPath)


if not origLoadConfig:
    origLoadConfig = girder.utility.config.loadConfig
    girder.utility.config.loadConfig = loadConfig

if __name__ == '__main__':
    app = GeoApp()
    app.start()
