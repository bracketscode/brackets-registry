/*
 * Copyright (c) 2013 Adobe Systems Incorporated. All rights reserved.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of this software and associated documentation files (the "Software"),
 * to deal in the Software without restriction, including without limitation
 * the rights to use, copy, modify, merge, publish, distribute, sublicense,
 * and/or sell copies of the Software, and to permit persons to whom the
 * Software is furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
 * DEALINGS IN THE SOFTWARE.
 *
 */


/*jslint vars: true, plusplus: true, devel: true, node: true, nomen: true,
indent: 4, maxerr: 50 */

"use strict";

var validate = require("brackets-extensibility/package-validator").validate,
    semver   = require("semver"),
    clone    = require("clone"),
    logger   = require("./logging"),
    user_utils = require("./user_utils"),
    _        = require("lodash");

/**
 * The data structure that keeps all of the registration information.
 *
 * @type {Object<{{metadata:Object, owner:String, versions:Array<Object>}}}
 */
var registry = null;

/**
 * Configuration that describes how the repository data is managed. Call
 * configure() before using this module.
 *
 * @type <Object>
 */
var config = null;

var storage = null;

var saveInterval = null;

var Errors = {
    NOT_AUTHORIZED:         "NOT_AUTHORIZED",
    BAD_VERSION:            "BAD_VERSION",
    VALIDATION_FAILED:      "VALIDATION_FAILED",
    REGISTRY_NOT_LOADED:    "REGISTRY_NOT_LOADED",
    DUPLICATE_TITLE:        "DUPLICATE_TITLE",
    UNKNOWN_EXTENSION:      "UNKNOWN_EXTENSION",

    // These failures do not need to be localized. They are only displayed to people
    // running the server.
    NOT_CONFIGURED:         "Repository not configured!"
};

function validConfiguration(callback) {
    if (config === null || storage === null) {
        callback(new Error(Errors.NOT_CONFIGURED));
        return false;
    }
    if (registry === null) {
        callback(new Error(Errors.REGISTRY_NOT_LOADED));
        return false;
    }
    return true;
}

/**
 * Checks the registry to see if any other extensions with the same
 * title are present (other than the extension named).
 * Returns false if the title is falsy.
 *
 * @param {String} name of the extension that is currently being validated
 * @param {String} title of that extension
 * @return true if the title is already present in another extension
 */
function titleAlreadyPresent(name, title) {
    if (!title) {
        return false;
    }

    title = title.toLowerCase();

    var key;
    for (key in registry) {
        if (registry.hasOwnProperty(key) && key !== name &&
                registry[key].metadata.title &&
                registry[key].metadata.title.toLowerCase() === title) {
            return true;
        }
    }
    return false;
}

function updateRecentDownloadsForPackage(name, newRecentDownloadDatapoints) {
    var updated;

    if (registry[name] && newRecentDownloadDatapoints) {
        var _currentRecentDownloadDatapoints,
            updatedRecentDownloads = {};

        if (!registry[name].recent) {
            registry[name].recent = {};
        }

        _currentRecentDownloadDatapoints = registry[name].recent;

        _(newRecentDownloadDatapoints).forEach(function (value, index) {
            updatedRecentDownloads[index] = updatedRecentDownloads[index] || 0;

            updatedRecentDownloads[index] += value;
        });

        _(_currentRecentDownloadDatapoints).forEach(function (value, index) {
            updatedRecentDownloads[index] = updatedRecentDownloads[index] || 0;

            updatedRecentDownloads[index] += value;
        });

        // Cut off all except for the recent 7 datapoints
        if (_currentRecentDownloadDatapoints.length !== _.size(updatedRecentDownloads)) {
            var result = {};

            // sort by date and cut off all except for 7 datapoints
            var recentDates = _(_(updatedRecentDownloads).keys().sort().reverse()).first(7);
            recentDates.forEach(function (date) {
                result[date] = updatedRecentDownloads[date];
            });

            // update registry
            registry[name].recent = result;
            updated = true;
        }
    }

    return updated;
}

/**
 * Add the download data to an existing registry entry.
 *
 * @param {!String} name - extension name
 * @param {!Object} newVersionDownloads - JSON object that contains download data for certain versions
 * @param {!Object} recentDownloads - JSON object that contains accumulated daily download data for certain versions
 *
 * Examples:
 *
 * Extension version is the key, the value is the accumulated downloads for this specific version
 * newVersionDownloads: "snippets-extension": {
 *                          "downloads": {
 *                             "versions": {
 *                                 { "0.3.0": 6,
 *                                   "0.3.1": 276,
 *                                   "0.4.3": 218
 *                                 }
 *                             }
 *                          }
 *                       }
 *
 * The date is the key and the value denotes the accumulated download on this day for the most recent version
 * of the extension.
 * recentDownloads: "snippets-extension": {
 *                      "downloads": {
 *                          "recent": {
 *                              "20130805": 8,
 *                              "20130806": 17,
 *                              "20130807": 16,
 *                              "20130808": 19,
 *                              "20130809": 28,
 *                              "20130810": 9,
 *                              "20130811": 5,
 *                              "20130812": 7
 *                          }
 *                      }
 *                  }
 *
 */
function addDownloadDataToPackage(name, newVersionDownloads, recentDownloads) {
    if (registry[name]) {
        var updated = false;

        logger.debug("Extension package with name " + name + " found");
        var packageVersions = registry[name].versions;

        Object.keys(newVersionDownloads).forEach(function (version) {
            var versionInfo = _.find(packageVersions, {"version": version});
            if (versionInfo) {
                var newDownloads = newVersionDownloads[version];

                if (!versionInfo.downloads) {
                    versionInfo.downloads = newDownloads;
                } else {
                    versionInfo.downloads += newDownloads;
                }

                // update total
                if (!registry[name].totalDownloads) {
                    registry[name].totalDownloads = newDownloads;
                } else {
                    registry[name].totalDownloads += newDownloads;
                }

                updated = true;
            }
        });

        var recentDownloadsUpdated = updateRecentDownloadsForPackage(name, recentDownloads);

        // save changes to registry if there were any updates
        if (updated || recentDownloadsUpdated) {
            storage.saveRegistry(registry);
        }
    }
}

/**
 * Adds or updates a package in the repository.
 *
 * The package is validated, the user's authorization is checked, the version
 * is checked to ensure that only newer versions of major branches are being uploaded.
 * If any of these fail, an Error is sent back to the callback.
 *
 * If there are no errors, the callback is called with the updated repository entry.
 *
 * @param {String} path to the package file
 * @param {String} user identifier for the person submitting the file (e.g. "github:someusername")
 * @param {Function} callback (err, entry)
 */
function addPackage(packagePath, user, callback) {
    if (!validConfiguration(callback)) {
        return;
    }
    validate(packagePath, {
        requirePackageJSON: true
    }, function (err, result) {
        if (err) {
            callback(err, null);
            return;
        }

        var error;

        if (result.errors && result.errors.length) {
            error = new Error(Errors.VALIDATION_FAILED);
            error.errors = result.errors;
            callback(error, null);
            return;
        }

        var name = result.metadata.name;

        if (titleAlreadyPresent(name, result.metadata.title)) {
            error = new Error(Errors.VALIDATION_FAILED);
            error.errors = [[Errors.DUPLICATE_TITLE, result.metadata.title]];
            callback(error, null);
            return;
        }

        // Look up the current repository entry to see if this is an add or update
        var entry;

        if (registry.hasOwnProperty(name)) {
            // update, we'll deep clone to hang on to the value
            entry = clone(registry[result.metadata.name]);

            // Verify that the user is authorized to add this package
            if (!user_utils.isOwner(entry, user)) {
                callback(new Error(Errors.NOT_AUTHORIZED), null);
                return;
            }

            // Verify that this is a higher version number
            var newVersion = result.metadata.version;
            var lastVersion = entry.versions[entry.versions.length - 1].version;
            if (!semver.gt(newVersion, lastVersion)) {
                callback(new Error(Errors.BAD_VERSION), null);
                return;
            }

            entry.versions.push({
                version: newVersion,
                published: new Date().toJSON()
            });

            entry.metadata = result.metadata;
        } else {
            // add
            entry = {
                metadata: result.metadata,
                owner: user.owner,
                versions: [{
                    version: result.metadata.version,
                    published: new Date().toJSON()
                }]
            };
        }

        storage.savePackage(entry, packagePath, function (err) {
            if (err) {
                callback(err, null);
            } else {
                registry[result.metadata.name] = entry;

                // Keep track of the Brackets compatibility information per version
                // so that the client can install the right version for the user's copy
                // of Brackets
                if (result.metadata.engines && result.metadata.engines.brackets) {
                    entry.versions[entry.versions.length - 1].brackets = result.metadata.engines.brackets;
                }

                storage.saveRegistry(registry);
                callback(null, entry);
            }
        });
    });
}

/**
 * Removes extension metadata from the registry. This is the form of "delete package" that we offer
 * today.
 *
 * @param {Object} entry of the package to remove
 */
function deletePackageMetadata(entry) {
    delete registry[entry.metadata.name];
}

/**
 * Changes the owner of an extension.
 *
 * @param {Object} entry from the extension registry
 * @param {string} newUserID of the new package owner
 */
function changePackageOwner(entry, newUserID) {
    entry.owner = newUserID;
}

/**
 * Change Brackets version requirements.
 *
 * @param {Object} entry from the extension registry
 * @param {string} requirements semver string for the extension's requirements
 */
function changePackageRequirements(entry, requirements) {
    var versions = entry.versions;
    versions.forEach(function (version) {
        version.brackets = requirements;
    });
}

/**
 * Wraps an extension manipulation function to automatically check that the named
 * package exists and that the user given has permission to edit. The rest of the
 * arguments are passed along to the package function.
 *
 * The last argument given is assumed to be a callback.
 *
 * @param {function} func function that performs the actual desired behavior
 * @param {string} name extension name
 * @param {string} userID owner or admin that is submitting the request
 */
function _packageManipulatorWrapper(func, name, user) {
    var callback = arguments[arguments.length - 1];
    var entry = registry[name];
    if (!entry) {
        callback(new Error(Errors.UNKNOWN_EXTENSION));
        return;
    }
    if (config.admins.indexOf(user.owner) === -1 && !user_utils.isOwner(entry, user)) {
        callback(new Error(Errors.NOT_AUTHORIZED));
        return;
    }

    // In the arguments to the package function, the name of the package is replaced by the
    // registry entry and we don't pass in the user ID. Any other arguments, including the
    // callback, are passed straight through.
    var args = [entry],
        counter;
    for (counter = 3; counter < arguments.length; counter++) {
        args.push(arguments[counter]);
    }
    func.apply(null, args);
    storage.saveRegistry(registry);
    callback(null);
}

/*
 * Sets the configuration in use by this module.
 *
 * @param <Object> configuration object read from JSON file
 */
function configure(newConfig) {
    config = newConfig;
    var storageType = config.storage;
    if (!storageType) {
        throw new Error("Storage not provided in config file");
    }
    registry = null;
    var Storage = require(storageType).Storage;
    storage = new Storage(config);
    storage.getRegistry(function (err, currentRegistry) {
        if (err) {
            console.error("Unable to load registry!", err);
            return;
        }
        registry = currentRegistry;
        console.log("this is working...");
    });
}

/*
 * Returns the current registry. Note that this is a reference to
 * the actual in-memory registry, so callers should not modify it
 * directly.
 *
 * @return {Object} The current registry. May be null if it hasn't yet
 * been initialized.
 */
function getRegistry() {
    return registry;
}

exports.Errors                    = Errors;
exports.addPackage                = addPackage;
exports.deletePackageMetadata     = _.partial(_packageManipulatorWrapper, deletePackageMetadata);
exports.changePackageOwner        = _.partial(_packageManipulatorWrapper, changePackageOwner);
exports.changePackageRequirements = _.partial(_packageManipulatorWrapper, changePackageRequirements);
exports.configure                 = configure;
exports.getRegistry               = getRegistry;
exports.addDownloadDataToPackage  = addDownloadDataToPackage;

// Testing
exports._updateRecentDownloadsForPackage = updateRecentDownloadsForPackage;
