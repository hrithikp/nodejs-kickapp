'use strict';

var util = require('util'),
    events = require('events'),
    Q = require('q'),
    _ = require('lodash'),
    ServiceWrapper = require('./ServiceWrapper').ServiceWrapper,
    graph = require('./graph')
    ;

/** Application: a collection of services
 *
 * @param {Function?} App
 *      Application constructor
 * @param {...args} args
 *      Application constructor arguments
 *
 * @event {Application#init} The application has initialized
 * @event {Application#start} The application has started
 * @event {Application#stop} The application has stopped
 *
 * @constructor
 * @implements {IService}
 */
var Application = exports.Application = function(App){
    /** Application services
     * @type {Object.<String, ServiceWrapper>}
     * @protected
     */
    this._services = {};

    // Init the application
    if (App)
        App.apply(this, _.toArray(arguments).slice(1));
};
util.inherits(Application, events.EventEmitter);

//region Configuration

/** Add a service
 * @param {String} name
 *      Service name
 * @param {Function} serviceConstructor
 *      Service constructor which implements the {IService} interface, or an instantiated object
 * @param {...args} args
 *      Service constructor arguments
 * @returns {ServiceWrapper}
 */
Application.prototype.addService = function(name, serviceConstructor){
    var service = new ServiceWrapper(this, name);
    service.create(serviceConstructor, _.toArray(arguments).slice(2));
    this._services[name] = service;
    return this;
};

/** Define service dependencies
 * @param {String|Array.<String>} serviceName
 *      Service names this one depends on
 * @param {...args} serviceNames
 *      More services
 * @returns {Application}
 */
Application.prototype.dependsOn = function(serviceName){
    var lastService = _.last(_.values(this._services));
    lastService.dependsOn.apply(lastService, arguments);
    return this;
};

//endregion

//region Structure

/** Get a service by name
 * @param {String} serviceName
 *      Name of the service to get
 * @returns {ServiceWrapper}
 * @throws {Error} on unknown service
 */
Application.prototype.getServiceWrapper = function(serviceName){
    if (!(serviceName in this._services))
        throw new Error('Undefined kickapp service: '+ serviceName);
    return this._services[serviceName];
};

/** Get a service by name
 * @param {String} serviceName
 *      Name of the service to get
 * @returns {IService}
 * @throws {Error} on unknown service
 */
Application.prototype.get = function(serviceName){
    return this.getServiceWrapper(serviceName).service;
};

/** Get the list of service names
 * @returns {Array.<String>}
 */
Application.prototype.getServiceNames = function(){
    return _.keys(this._services);
};

/** Is the Application running?
 * An Application is running if all its services are running
 * @returns {Boolean}
 */
Application.prototype.isRunning = function(){
    return _.all(
        _.pluck(this._services, 'running')
    );
};

//endregion

//region Workflow

/** Resolve service dependencies and generate the run sequence
 * @returns {Array.<ServiceWrapper>}
 * @protected
 */
Application.prototype._servicesSequence = function(){
    var G = _.compose(_.object, _.map)(this._services, function(service){
            return [service.name, service.dependencies];
        }),
        sequence = graph.toposort(G)
        ;

    // Convert to services
    var self = this;
    return sequence.map(function(serviceName){
        return self.getServiceWrapper(serviceName);
    });
};

/** Initialize services.
 * Runs init() on each, honoring the dependencies graph.
 * @returns {Q} promise
 */
Application.prototype.init = function(){
    return this._servicesSequence().map(function(service){
        return service.init.bind(service);
    }).reduce(Q.when, Q(1))
        .then(_.partial(this.emit.bind(this), 'init'));
};

/** Start services.
 * Runs start() on each, honoring the dependencies graph.
 * If any service is not initialized, it's initialized first
 * @returns {Q} promise
 */
Application.prototype.start = function(){
    // Init, if any service is not initialized, do it
    return Q(!_.all(this._services, 'initialized') && this.init())
        // Start services
        .then(function(){
            return this._servicesSequence().map(function(service){
                return service.start.bind(service);
            }).reduce(Q.when, Q(1))
                .then(_.partial(this.emit.bind(this), 'start'));
        }.bind(this));
};

/** Initialize services.
 * Runs stop() on each, honoring the dependencies graph.
 * @returns {Q} promise
 */
Application.prototype.stop = function(){
    return this._servicesSequence().reverse().map(function(service){
        return service.stop.bind(service);
    }).reduce(Q.when, Q(1))
        .then(_.partial(this.emit.bind(this), 'stop'));
};

//endregion
