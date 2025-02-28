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

/*
 * N.B.: This file is the source for `src/extensibility/registry_utils.js` in Brackets.
 * We can't use the exact same file currently because Brackets uses AMD-style modules, so the Brackets
 * version has the AMD wrapper added (and is reindented to avoid JSLint complaints).
 * If changes are made here, the version in Brackets should be kept in sync.
 * In the future, we should have a better mechanism for sharing code between the two.
 */

/*jslint vars: true, plusplus: true, node: true, nomen: true, indent: 4, maxerr: 50 */
/*global define*/

"use strict";

// From Brackets StringUtils
function htmlEscape(str) {
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

/**
 * Gets the last version from the given object and returns the short form of its date.
 * Assumes "this" is the current template context.
 * @return {string} The formatted date.
 */
exports.lastVersionDate = function () {
    var result;
    if (this.versions && this.versions.length) {
        result = this.versions[this.versions.length - 1].published;
        if (result) {
            // Just return the ISO-formatted date, which is the portion up to the "T".
            var dateEnd = result.indexOf("T");
            if (dateEnd !== -1) {
                result = result.substr(0, dateEnd);
            }
        }
    }
    return result || "";
};

/**
 * Returns a more friendly display form of the owner's internal user id.
 * Assumes "this" is the current template context.
 * @return {string} A display version in the form "id (service)".
 */
exports.formatUserId = function () {
    var friendlyName;
    if (this.user && this.user.owner) {
        var nameComponents = this.user.owner.split(":");
        friendlyName = nameComponents[1];
    }
    return friendlyName;
};

/**
 * Given a registry item, returns a URL that represents its owner's page on the auth service.
 * Currently only handles GitHub.
 * Assumes "this" is the current template context.
 * @return {string} A link to that user's page on the service.
 */
exports.ownerLink = function () {
    var url;
    if (this.user && this.user.owner) {
        var nameComponents = this.user.owner.split(":");
        if (nameComponents[0] === "github") {
            url = "https://github.com/" + nameComponents[1];
        }
    }
    return url;
};

/**
 * Given a registry item, formats the author information, including a link to the owner's
 * github page (if available) and the author's name from the metadata.
 */
exports.authorInfo = function () {
    var result = "",
        ownerLink = exports.ownerLink.call(this),
        userId = exports.formatUserId.call(this);
    if (this.metadata && this.metadata.author) {
        // author can be either a string or an object with a "name" field
        result += htmlEscape(this.metadata.author.name || this.metadata.author);
    }
    if (userId) {
        if (result !== "") {
            result += " / ";
        }
        result += "<a href='" + htmlEscape(ownerLink) + "'>" + htmlEscape(userId) + "</a>";
    }
    return result;
};

/**
 * URL encodes the extension name and the version.
 *
 * @param {string} baseURL The registry base url
 * @param {string} name The name of the extension
 * @param {string} version The version of the extension
 *
 * @return {string} An URI to download the extension
 */
exports.formatDownloadURL = function (baseURL, name, version) {
    var urlEncodedName = encodeURIComponent(name),
        urlEncodedNameAndVersion = encodeURIComponent(name + "-" + version + ".zip");

    //return baseURL + "/" + urlEncodedName + "/" + urlEncodedNameAndVersion;
    return baseURL + "/" + urlEncodedNameAndVersion;
};

/**
 * Returns an array of current registry entries, sorted by the publish date of the latest version of each entry.
 * @param {object} registry The unsorted registry.
 * @param {string} subkey The subkey to look for the registry metadata in. If unspecified, assumes
 *     we should look at the top level of the object.
 * @return {Array} Sorted array of registry entries.
 */
exports.sortRegistry = function (registry, subkey) {
    function getPublishTime(entry) {
        if (entry.versions) {
            return new Date(entry.versions[entry.versions.length - 1].published).getTime();
        }

        return Number.NEGATIVE_INFINITY;
    }

    var sortedEntries = [];

    // Sort the registry by last published date (newest first).
    Object.keys(registry).forEach(function (key) {
        sortedEntries.push(registry[key]);
    });
    sortedEntries.sort(function (entry1, entry2) {
        return getPublishTime((subkey && entry2[subkey]) || entry2) -
            getPublishTime((subkey && entry1[subkey]) || entry1);
    });

    return sortedEntries;
};
