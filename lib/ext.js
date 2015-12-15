'use strict';

const _    = require('lodash');
const Boom = require('boom');
const Hoek = require('hoek');
const Qs   = require('qs');

const internals = {
    isValidRoute: function (request) {

        const include = this.config.routes.include;
        const exclude = this.config.routes.exclude;
        const path    = request.route.path;
        const method  = request.route.method;


        return (method === 'get' &&
               (include[0] === '*' ||  _.includes(include, path)) &&
               !_.includes(exclude, path));
    },
    getPagination: function (request, config) {
        let pagination = request.query[config.query.pagination.name];

        if (pagination === 'false') {
            pagination = false;
        } else if (pagination === 'true') {
            pagination = true;
        } else {
            pagination = config.query.pagination.default;
        }

        return pagination;
    },
    name: function (arg) {
        return this.config.meta[arg].name;
    },
    assignIfActive: function (meta, name, value) {
        if (this.config.meta[name].active) {
            meta[this.name(name)] = value;
        }
    }
};


module.exports = function (config) {

    internals.config = config;

    return {
        onPreHandler: function (request, reply) {


            // If the route does not match, just skip this part
            if (internals.isValidRoute(request)) {

                const pagination = internals.getPagination(request, config);
                request.query[config.query.pagination.name] = pagination;

                if (pagination === false) {
                    return reply.continue();
                }

                let page = config.query.page.default;
                let limit = config.query.limit.default;

                // Checks for overriding options
                const checkRoute = function (v) {
                    const match = _.includes(v.routes, request.route.path);
                    if (match) {
                        page = v.page;
                        limit = v.limit;
                    }

                    return !match;
                };

                _.every(config.routes.override, checkRoute);

                const setParam = function (arg, defaultValue) {

                    const name = internals.name(arg);
                    let value = null;

                    if (_.has(request.query, name)) {
                        value = _.parseInt(request.query[name]);

                        if (_.isNaN(value)) {
                            if (config.query.invalid === 'defaults') {
                                value = config.query[arg].default;
                            } else {
                                throw { message: 'Invalid ' + name };
                            }
                        }
                    }

                    request.query[name] = value || defaultValue;
                };

                try {
                    setParam('page', page);
                    setParam('limit', limit);
                } catch(err) {
                    return reply(Boom.badRequest(err.message));
                }
            }

            return reply.continue();
        },




        onPreResponse: function (request, reply) {

            if (internals.isValidRoute(request) &&
                !request.response.isBoom &&
                request.query[config.query.pagination.name] === true) {

                // Removes pagination from query parameters
                delete request.query[config.query.pagination.name];

                const source = request.response.source;
                const results = Array.isArray(source) ? source : source.results;
                Hoek.assert(Array.isArray(results), 'The results must be an array');

                const totalCount = request.response.source.totalCount || request[config.meta.totalCount.name];

                const baseUri = config.uri + request.url.pathname + '?';
                const qs = request.query; // Query parameters
                const qsPage = qs[config.query.page.name]; // Current page

                const meta = {};

                const getPageCount = function () {
                    return Math.trunc(totalCount / qs[config.query.limit.name]) +
                         ((totalCount % qs[config.query.limit.name] === 0) ? 0 : 1);
                };

                const getUrl = function (page) {
                    const override = {
                        [config.query.page.name]: page
                    };

                    return baseUri + Qs.stringify(Hoek.applyToDefaults(qs, override));
                };

                internals.assignIfActive(meta, 'page', qs[internals.name('page')]);
                internals.assignIfActive(meta, 'limit', qs[internals.name('limit')]);
                internals.assignIfActive(meta, 'count', results.length);
                internals.assignIfActive(meta, 'totalCount', totalCount || null);
                internals.assignIfActive(meta, 'pageCount', totalCount ? getPageCount() : null);
                internals.assignIfActive(meta, 'self', baseUri + Qs.stringify(qs));
                internals.assignIfActive(meta, 'previous', qsPage !== 1 ? getUrl(qsPage - 1) : null);

                const hasNext = totalCount && qsPage < getPageCount();
                internals.assignIfActive(meta, 'next', hasNext ? getUrl(qsPage + 1) : null);
                internals.assignIfActive(meta, 'first', getUrl(1));
                internals.assignIfActive(meta, 'last', totalCount ? getUrl(getPageCount()) : null);

                request.response.source = {
                    [config.meta.name]: meta,
                    [config.results.name]: results
                };

            }

            return reply.continue();

        }
    };
};