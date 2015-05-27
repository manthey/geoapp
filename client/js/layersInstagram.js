/* Copyright 2015 Kitware Inc.
 *
 *  Licensed under the Apache License, Version 2.0 ( the "License" );
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 */

/* -------- instagram layer -------- */

geoapp.mapLayers.instagram = function (map, arg) {
    'use strict';
    var datakey = 'instagram';

    if (!(this instanceof geoapp.mapLayers[datakey])) {
        return new geoapp.mapLayers[datakey](map, arg);
    }
    arg = arg || {};
    geoapp.MapLayer.call(this, map, datakey, arg);

    var m_this = this,
        m_geoPoints,
        m_overlayTimer,
        m_mapEventsSet,
        m_currentPoint = null,
        m_currentPointSource = '',
        m_persistentCurrentPoint = false,
        m_inPoints = {top: [], other: []},
        m_lastMouseDownEvent,
        m_lastPanEvent,

        m_defaultOpacity = 0.1,
        m_pointColor = geo.util.convertColor('#FF0000'),
        m_strokeColor = geo.util.convertColor('#E69F00');

    var geoLayer;

    geoLayer = map.getMap().createLayer('feature', {
        renderer: 'vgl'
    });
    m_geoPoints = geoLayer.createFeature('point', {
        primitiveShape: 'triangle',
        selectionAPI: true,
        dynamicDraw: true
    });

    this.paramChangedKeys = [
        'data-opacity', 'display-date_min', 'display-date_max',
        'show-instagram-data'
    ];

    /* Update the taxi map based on the map parameters.  Values that are
     * updated include:
     *    inst-opacity: the opacity used for non-animated points.
     *
     * @param params: the new map parameters.
     */
    this.updateMapParams = function (params) {
        var visParam = {
                dateMin: params['display-date_min'] ?
                    0 + moment.utc(params['display-date_min']) : null,
                dateMax: params['display-date_max'] ?
                    0 + moment.utc(params['display-date_max']) : null,
                dateColumn: 'posted_date'
            },
            data = m_this.data(true, visParam),
            visible = (params['show-instagram-data'] !== false && data);
        m_geoPoints.visible(visible);
        if (!visible) {
            return;
        }
        if (params['display-max-points'] > 0) {
            this.maximumMapPoints = params['display-max-points'];
        }
        if (params['data-opacity'] > 0) {
            params['inst-opacity'] = params['data-opacity'];
        }
        data.numPoints = Math.min(data.data.length, this.maximumMapPoints);
        data.x_column = data.columns.longitude;
        data.y_column = data.columns.latitude;
        var pointData = data.data || [];
        if (pointData.length > this.maximumMapPoints) {
            pointData = data.data.slice(0, this.maximumMapPoints);
        }
        m_geoPoints.data(pointData)
        .style({
            fillColor: m_pointColor,
            fillOpacity: params['inst-opacity'] || m_defaultOpacity,
            strokeColor: m_strokeColor,
            strokeOpacity: 1,
            strokeWidth: 5,
            stroke: false,
            radius: 5
        })
        .position(function (d) {
            return {
                x: d[data.x_column],
                y: d[data.y_column]
            };
        })
        .geoOff(geo.event.feature.mouseover)
        .geoOn(geo.event.feature.mouseover, function (evt) {
            m_this.highlightPoint(evt.index, evt, true);
        })
        .geoOff(geo.event.feature.mouseout)
        .geoOn(geo.event.feature.mouseout, function (evt) {
            m_this.highlightPoint(evt.index, evt, false);
        });
        m_geoPoints.layer().geoOff(geo.event.pan)
        .geoOn(geo.event.pan, m_this.panLayer);
        $(this.map.getMap().node()).off('.instagram-map-layer').on(
            'mousedown.instagram-map-layer click.instagram-map-layer',
            m_this.clickLayer);
        this.currentPoint(null, false);
    };

    /* Return the index of the date column for this data.
     *
     * @return: the date column, or null if undefined. */
    this.getDateColumn = function () {
        var data = m_this.data();
        if (!data || !data.columns) {
            return null;
        }
        return data.columns.posted_date;
    };

    /* Calculate bins for animation
     *
     * @param param: animation parameters.  The dataBin field should be added
     *               at a minimum.
     * @param start: start of animation interval in epoch milliseconds.
     * @param range: milliseconds for animation cycle (for instance, if this is
     *               showing one week, collecting all the weeks in a year, this
     *               is the number of ms in a week).
     * @param binWidth: width of each bin in milliseconds.
     */
    this.binForAnimation = function (params, start, range, binWidth) {
        var mapData = m_this.data(true),
            dateColumn = this.getDateColumn(),
            data, i;

        if (!mapData || !mapData.data) {
            return;
        }
        data = mapData.data;
        var dataLength = mapData.numPoints;
        var dataBin = new Int32Array(dataLength);
        params.layers[this.datakey] = {dataBin: dataBin};
        for (i = 0; i < mapData.numPoints; i += 1) {
            dataBin[i] = Math.floor(((
                data[i][dateColumn] - start) % range) /
                binWidth);
        }
    };

    /* Update the animation frame for this layer.
     *
     * @param options: animation options.
     */
    this.animateFrame = function (options) {
        if (!options.layers[this.datakey]) {
            return;
        }
        var mapParams = m_this.map.getMapParams(),
            mapData = m_this.data(true),
            visOpac = (options.opacity || 0.1),
            dataBin = options.layers[this.datakey].dataBin,
            i, j, v, opac, vis, vpf;

        if (mapParams['data-opacity']) {
            visOpac = Math.min(mapParams['data-opacity'] * 1.5, 1);
        }
        vpf = m_geoPoints.verticesPerFeature();
        opac = m_geoPoints.actors()[0].mapper().getSourceBuffer('fillOpacity');
        for (i = 0, v = 0; i < mapData.numPoints; i += 1) {
            vis = this.inAnimationBin(
                dataBin[i], options.numBins, options.step,
                options.substeps);
            vis = (vis ? visOpac : 0);
            for (j = 0; j < vpf; j += 1, v += 1) {
                opac[v] = vis;
            }
        }
        m_geoPoints.actors()[0].mapper().updateSourceBuffer('fillOpacity');
    };

    /* Stop any animation and show the unanimated data.
     */
    this.animateStop = function () {
        var mapParams = m_this.map.getMapParams(),
            mapData = m_this.data(true),
            vpf, opac, v;

        if (!mapData) {
            return;
        }
        vpf = m_geoPoints.verticesPerFeature();
        opac = m_geoPoints.actors()[0].mapper().getSourceBuffer('fillOpacity');
        for (v = 0; v < mapData.numPoints * vpf; v += 1) {
            opac[v] = mapParams['inst-opacity'] || m_defaultOpacity;
        }
        m_geoPoints.actors()[0].mapper().updateSourceBuffer(
            'fillOpacity');
    };

    /* Return the current internal state of the layer.
     *
     * @param key: the key of the object to fetch, or undefined for a
     *             dictionary of objects.
     * @returns: a dictionary of the current state, or one of the internal
     *           state objects.
     */
    this.getInternalState = function (key) {
        var state = {
            geoPoints: m_geoPoints,
            defaultOpacity: m_defaultOpacity,
            currentPoint: m_currentPoint,
            currentPointSource: m_currentPointSource,
            persistentCurrentPoint: m_persistentCurrentPoint,
            inPoints: m_inPoints,
            pointColor: m_pointColor,
            strokeColor: m_strokeColor
        };
        if (key) {
            return state[key];
        }
        return state;
    };

    /* When the mouse hovers above a point on the map, indicate this.
     *
     * @param idx: 0-based index in the data array.
     * @param evt: the event that triggered this call.
     * @param over: true if the mouse if over the point, false if it just left.
     */
    this.highlightPoint = function (idx, evt, over) {
        var vpf = m_geoPoints.verticesPerFeature(),
            opac;
        if (over) {
            opac = m_geoPoints.actors()[0].mapper().getSourceBuffer(
                'fillOpacity');
            if (idx * vpf >= opac.length || !opac[idx * vpf]) {
                over = false;
            }
        }
        if ((!over || !evt.top) && $.inArray(idx, m_inPoints.top) >= 0) {
            m_inPoints.top.splice($.inArray(idx, m_inPoints.top), 1);
        }
        if ((!over || evt.top) && $.inArray(idx, m_inPoints.other) >= 0) {
            m_inPoints.other.splice($.inArray(idx, m_inPoints.other), 1);
        }
        if (over && evt.top && $.inArray(idx, m_inPoints.top) < 0) {
            m_inPoints.top.push(idx);
        }
        if (over && !evt.top && $.inArray(idx, m_inPoints.other) < 0) {
            m_inPoints.other.push(idx);
        }
        if (!m_persistentCurrentPoint) {
            this.currentPoint(this.getHighlightPoint(), undefined, undefined,
                              'map');
        }
    };

    /* Return the first top-most point that should be highlighted by a hovered
     * or clicked mouse.
     *
     * @return: the 0-based point index or null.
     */
    this.getHighlightPoint = function () {
        if (m_inPoints.top.length) {
            return m_inPoints.top[0];
        }
        if (m_inPoints.other.length) {
            return m_inPoints.other[0];
        }
        return null;
    };

    /* Handle clicking on the map.  Set the current point according to
     * highlighting rules to a persistent point.
     *
     * @param evt: the event that triggered this call.
     */
    this.clickLayer = function (evt) {
        if (evt.type === 'mousedown') {
            m_lastMouseDownEvent = new Date().getTime();
            return;
        }
        if (m_lastMouseDownEvent < m_lastPanEvent) {
            return;
        }
        if (!m_geoPoints.visible()) {
            m_this.currentPoint(null, true, true, 'map');
            return;
        }
        var idx = m_this.getHighlightPoint();
        m_this.persistentCurrentPoint(idx);
        m_this.currentPoint(idx, true, true, 'map');
        evt.stopPropagation();
        evt.preventDefault();
    };

    /* When the map is panned, record that it was done so that we can
     * differentiate a click from a pan.  If we have a persistent overlay,
     * adjust its position.
     *
     * @param evt: the event that triggered this call.
     */
    this.panLayer = function (evt) {
        if (evt.screenDelta && !evt.screenDelta.x && !evt.screenDelta.y) {
            return;
        }
        m_lastPanEvent = new Date().getTime();
        if (m_persistentCurrentPoint && m_currentPoint !== null) {
            m_this.showOverlay(true);
        }
    };

    /* Get or set a point as the current point.  If setting, mark it as the
     * current point and set a timer to display the instagram picture soon.
     *
     * @param cur: undefined to get the current point.  Otherwise, the 0-based
     *             point index, or null to clear the current point.
     * @param redraw: if false, don't redraw the map.  If true, always update.
     * @param immediate: if true, show or hide the overlay immediately.
     * @param source: name of the source of setting this point.  Used in
     *                logging.
     * @param currentPoint: the current point (an integer) or null if there is
     *                      no current point.
     */
    this.currentPoint = function (cur, redraw, immediate, source) {
        if (cur === undefined) {
            return m_currentPoint;
        }
        m_currentPointSource = source || m_currentPointSource || '';
        cur = !isNaN(parseInt(cur)) ? parseInt(cur) : null;
        if (cur === m_currentPoint && redraw !== true) {
            return m_currentPoint;
        }
        if (cur === null) {
            m_persistentCurrentPoint = false;
        }
        var vpf = m_geoPoints.verticesPerFeature(),
            stroke, i, old = m_currentPoint;

        stroke = m_geoPoints.actors()[0].mapper().getSourceBuffer('stroke');
        for (i = 0; i < vpf; i += 1) {
            if (old !== null && old * vpf < stroke.length) {
                stroke[old * vpf + i] = 0;
            }
            if (cur !== null && cur * vpf < stroke.length) {
                stroke[cur * vpf + i] = 1;
            }
        }
        m_geoPoints.actors()[0].mapper().updateSourceBuffer('stroke');
        if (redraw !== false) {
            this.map.triggerDraw();
        }
        m_currentPoint = cur;
        /* If no point is selected, use a shorter timeout for the overlay. */
        var delay = !cur ? 125 : 250;
        if (m_overlayTimer) {
            window.clearTimeout(m_overlayTimer);
            m_overlayTimer = null;
        }
        if (!immediate) {
            m_overlayTimer = window.setTimeout(this.showOverlay, delay);
        } else {
            this.showOverlay();
        }
        if (cur && !m_mapEventsSet && $('#ga-main-map').length) {
            $('#ga-main-map').on('mouseleave', function () {
                if (!m_persistentCurrentPoint) {
                    m_this.currentPoint(null);
                }
            });
            m_mapEventsSet = true;
        }
        return m_currentPoint;
    };

    /* Get or set if the current point is persistent. If it is persistent, a
     * close icon is shown on the overlay.
     *
     * @param persistent: if undefined, just return the state of persistence.
     *                    If an integer or a string that can be cast to an
     *                    integer, set the persistence if this value is not the
     *                    same as the current point or persistence if off.  If
     *                    persistence in on and this is the currenr point,
     *                    toggle it off.  If not an integer, set the
     *                    persistence to the truthiness of this value.
     * @param source: source of this call for logging.
     * @return: a boolean with the state of persistence.
     */
    this.persistentCurrentPoint = function (persistent, source) {
        if (persistent === undefined) {
            return m_persistentCurrentPoint;
        }
        if (!isNaN(parseInt(persistent))) {
            persistent = parseInt(persistent);
            persistent = (!m_persistentCurrentPoint ||
                          persistent !== m_currentPoint);
        }
        persistent = !!persistent;
        if (persistent !== m_persistentCurrentPoint) {
            geoapp.activityLog.logActivity('pin_overlay',
                source || 'map', {}, 'instagram_overlay');
        }
        m_persistentCurrentPoint = persistent;
        return m_persistentCurrentPoint;
    };

    /* Show or hide the overlay based on the current point.  If the current
     * point is off the screen, show the overlay as close to that point as we
     * can.
     *
     * @param onlyMove: if true, only update the position.
     */
    this.showOverlay = function (onlyMove) {
        m_overlayTimer = null;
        var mapData = m_this.data(true),
            overlay = $('#ga-instagram-overlay');
        if (m_currentPoint === null || !mapData.data ||
                m_currentPoint >= mapData.data.length) {
            if (overlay.css('display') !== 'none') {
                geoapp.activityLog.logActivity('hide_overlay', 'map', {
                    url: null
                }, 'instagram_overlay');
            }
            overlay.css('display', 'none');
            return;
        }
        var item = mapData.data[m_currentPoint];
        var mapW = $('#ga-main-map').width(),
            mapH = $('#ga-main-map').height(),
            pos = m_this.map.getMap().gcsToDisplay({
                x: item[mapData.columns.longitude],
                y: item[mapData.columns.latitude]
            }),
            offset = 10,
            url = item[mapData.columns.image_url],
            imageUrl,
            caption = item[mapData.columns.caption] || '',
            date = moment(item[mapData.columns.posted_date]).utcOffset(0
                ).format('YYYY MMM D HH:mm');
        if (pos.x >= 0 && pos.y >= 0 && pos.x <= mapW && pos.y <= mapH) {
            $('.ga-instagram-overlay-arrow', overlay).css('display', 'none');
        } else {
            /* Clamp position to the screen, so that the overlay is always
            /* visible.  Point an arrow to where the point is located. */
            var dx = 0, dy = 0;
            /* jscs:disable requireBlocksOnNewline */
            if (pos.x < 0) {    dx = pos.x;         pos.x = 0; }
            if (pos.x > mapW) { dx = pos.x - mapW;  pos.x = mapW; }
            if (pos.y < 0) {    dy = pos.y;         pos.y = 0; }
            if (pos.y > mapH) { dy = pos.y - mapH;  pos.y = mapH; }
            /* jscs:enable requireBlocksOnNewline */
            $('.ga-instagram-overlay-arrow', overlay).css({
                display: 'block',
                transform: 'rotate(' + Math.atan2(dy, dx).toFixed(3) + 'rad)'
            });
            offset = 0;
        }
        /* Bias very slightly to the upper right */
        var bias = 5,
            ctrX = mapW / 2 + bias,
            ctrY = mapH / 2 - bias;
        overlay.css({
            left:   pos.x < ctrX ? (pos.x + offset) + 'px' : '',
            right:  pos.x < ctrX ? '' : (mapW - pos.x + offset) + 'px',
            top:    pos.y < ctrY ? (pos.y + offset) + 'px' : '',
            bottom: pos.y < ctrY ? '' : (mapH - pos.y + offset) + 'px'
        });
        overlay.attr('point', m_currentPoint);
        if (onlyMove) {
            return;
        }
        $('.ga-instagram-overlay-date', overlay).text(date).attr(
            'title', date);
        $('.ga-instagram-overlay-caption', overlay).text(caption).attr(
            'title', caption);
        $('.ga-instagram-overlay-position', overlay).text(geoapp.formatLatLon({
                x: item[mapData.columns.longitude],
                y: item[mapData.columns.latitude]
            })).attr('title', geoapp.formatLatLon({
                x: item[mapData.columns.longitude],
                y: item[mapData.columns.latitude]
            }, true));
        $('.ga-instagram-overlay-link a', overlay).text(url).attr(
            'href', url);
        $('.ga-instagram-overlay-title-bar', overlay).css('display',
            m_persistentCurrentPoint ? 'block' : 'none');
        overlay.off('.instagram-overlay');
        $('*', overlay).off('.instagram-overlay');
        if (!m_persistentCurrentPoint) {
            overlay.on('mouseenter.instagram-overlay', function () {
                if (m_overlayTimer) {
                    window.clearTimeout(m_overlayTimer);
                    m_overlayTimer = null;
                }
            }).on('mouseleave.instagram-overlay', function () {
                m_overlayTimer = window.setTimeout(function () {
                    m_this.currentPoint(null, true, true);
                }, 500);
            });
        } else {
            $('.ga-instagram-overlay-goto', overlay).on(
                    'click.instagram-overlay', m_this.centerOnMap);
            $('.ga-instagram-overlay-close-button', overlay).on(
                    'click.instagram-overlay', function () {
                m_this.currentPoint(null, true, true);
            });
        }
        $('.ga-instagram-overlay-arrow', overlay).on(
            'click.instagram-overlay', m_this.centerOnMap);
        imageUrl = url.replace(/\/$/, '') + '/media?size=m';
        if ($('img', overlay).attr('orig_url') !== url) {
            overlay.css('display', 'none');
            $('.ga-instagram-overlay-image', overlay).css('display', 'none');
            $('img', overlay).off('.instagram-overlay'
            ).on('load.instagram-overlay', function () {
                $('.ga-instagram-overlay-image', overlay).css('display', '');
                overlay.css('display', 'block');
                geoapp.activityLog.logActivity('show_overlay', 'map', {
                    source: m_currentPointSource || '',
                    imageUrl: imageUrl,
                    url: url
                }, 'instagram_overlay');
            }).on('error.instagram-overlay', function () {
                overlay.css('display', 'block');
                geoapp.activityLog.logActivity('show_overlay', 'map', {
                    source: m_currentPointSource || '',
                    url: url
                }, 'instagram_overlay');
            }).attr({src: imageUrl, orig_url: url});
        } else {
            overlay.css('display', 'block');
        }
    };

    /* Center the currently highlighted point on the map.
     */
    this.centerOnMap = function () {
        var mapData = m_this.data(true),
            overlay = $('#ga-instagram-overlay'),
            point = (m_currentPoint === null ? overlay.attr('point') :
                     m_currentPoint);
        var item = mapData.data[point];
        m_this.map.getMap().transition({
            center: {
                x: item[mapData.columns.longitude],
                y: item[mapData.columns.latitude]
            },
            interp: d3.interpolateZoom,
            duration: 1000
        });
    };
};

inherit(geoapp.mapLayers.instagram, geoapp.MapLayer);
