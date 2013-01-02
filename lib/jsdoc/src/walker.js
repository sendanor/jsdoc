/**
 * Traversal utilities for the AST. Adapted from
 * [Rocambole](https://github.com/millermedeiros/rocambole).
 * @module jsdoc/src/walker
 * @license MIT
 */

var SYNTAX = require('esprima').Syntax;
var SKIP_RECURSION = {
    comments: true,
    enclosingFunction: true,
    leadingComments: true,
    loc: true,
    next: true,
    parent: true,
    prev: true,
    range: true,
    tokens: true
};

/**
 * @todo docs
 *
 * @private
 */
function _recurse(node, fn, parent, prev, next) {
    var isArray = require('util').isArray;

    if (typeof node !== 'object') {
        return false;
    }
    //console.log('recursing over ' + JSON.stringify(JSON.decycle(node), null, 2));

    if ( fn(node, parent, prev, next) === false ) {
        // stop recursion
        return;
    }

    Object.keys(node).forEach(function(key) {
        var child = node[key];

        // only need to recurse real nodes and arrays
        if (child === null || typeof child !== 'object' || SKIP_RECURSION[key]) {
            return;
        }

        if (typeof child.type === 'string') {
            _recurse(child, fn, node);
        } else if ( isArray(child) ) {
            child.forEach(function(c, i) {
                _recurse(c, fn, node, (i ? child[i - 1] : undefined), child[i + 1] );
            });
        }
    });

    return node;
}

/**
 * Check whether an AST node represents a function.
 *
 * @private
 * @param {Object} node - The AST node to check.
 * @return {Boolean} Set to `true` if the node represents a function declaration or function
 * expression, or `false` in all other cases.
 */
function isFunctionNode(node) {
    return node && typeof node === 'object' && node.type === (SYNTAX.FunctionDeclaration ||
        SYNTAX.FunctionExpression);
}

/**
 * Check whether an AST node represents the root of the AST.
 *
 * @private
 * @param {Object} node - The AST node to check.
 * @return {Boolean} Set to `true` if the node is the AST's root node, or `false` in all other
 * cases.
 */
function isRootNode(node) {
    return node && node.type === SYNTAX.Program;
}

/**
 * @todo docs
 *
 * @private
 */
function getEnclosingFunction(node) {
    // the root node doesn't have an enclosing function
    if ( isRootNode(node) ) {
        return null;
    }

    var parent = node.parent;
    while ( parent !== null && !isFunctionNode(parent) ) {
        parent = parent.parent;
    }

    // the root node is never an enclosing function; also, a function can't enclose itself
    if (isRootNode(parent) || node === parent) {
        return null;
    }

    return parent;
}

/**
 * Create a walker that can traverse the specified AST.
 *
 * @todo docs
 * @memberof module:jsdoc/src/walker
 */
var Walker = module.exports = function(ast, nextId) {
    //require('jsdoc/util/cycle'); // TODO: remove
    this.ast = _recurse(ast, function(node, parent, prev, next) {
        node.parent = parent || null;
        node.prev = prev || null;
        node.next = next || null;
        node.depth = parent ? parent.depth + 1 : 0;
        node.uid = nextId();
        node.enclosingFunction = getEnclosingFunction(node);
    });
};

/**
 * Walk the AST nodes recursively, starting from the root node.
 *
 * @param {Object} ast - The Esprima AST to walk.
 * @param {Function} visitor - The function to call on each node.
 * @return {Object} The transformed AST.
 */
Walker.prototype.recurse = function(visitor) {
    return _recurse(this.ast, visitor);
};

/**
 * Walk the AST nodes, starting from the deepest leaf nodes and working up to the root node.
 *
 * @param {Object} ast - The Esprima AST to walk.
 * @param {Function} visitor - The function to call on each node.
 * @return {Object} The transformed AST.
 */
Walker.prototype.moonwalk = function(visitor) {
    // simplified sorted insert based on node.depth
    var nodes = [];

    _recurse(this.ast, function(node) {
        var n = nodes.length;
        var cur;
        do {
            cur = nodes[--n];
        } while (cur && node.depth > cur.depth);
        nodes.splice(n + 1, 0, node);
    });
    nodes.forEach(visitor);

    return this.ast;
};
