/**
 * @module jsdoc/src/visitor
 * @private
 */

var SYNTAX = require('esprima').Syntax;

/**
 * Find the name and type of the given node.
 *
 * @private
 * @memberof module:jsdoc/src/visitor.Visitor
 */
var AboutNode = {};

/**
 * @todo docs
 */
AboutNode.getInfo = function(node) {
    // TODO: does this ever happen?
    if (!this[node.type]) {
        throw new Error( 'called AboutNode.getInfo on node with unrecognized type: ' +
            JSON.stringify(node) );
    }

    var about = {};
    var paramNames = [];

    // TODO: not setting about.node, because it essentially duplicates about.type; is that ok?
    about = this[node.type](node, about);

    // add the node's function parameters, if any
    if (node.params && node.params.length) {
        for (var i = 0, l = node.params.length; i < l; i++) {
            paramNames.push(node.params[i].name);
        }

        about.paramnames = paramNames;
    }

    return about;
};

/**
 * @todo docs
 * @private
 */
AboutNode[SYNTAX.FunctionDeclaration] = function(node, about) {
    about.name = node.id.name;
    about.type = node.type;
    about.value = node.type;

    return about;
};

/**
 * @todo docs
 * @private
 */
AboutNode[SYNTAX.FunctionExpression] = function(node, about) {
    // XXX old parser only sets name for FunctionDeclaration, but a FunctionExpression can
    // have a name, too...
    about.name = node.id.name;
    about.type = node.type;
    about.value = node.init.type;

    return about;
};

/**
 * @todo docs
 * @private
 */
AboutNode[SYNTAX.VariableDeclarator] = function(node, about) {
    about.name = node.id.name;

    // like 'var a = 0;' or 'var a = b;'
    if ( node.init && node.init.type === (SYNTAX.Literal || SYNTAX.Identifier) ) {
        about.type = node.init.type;
        about.value = node.init.value;
    }
    // like 'var a = {b: 0};' or 'var a = function() {};'
    else if (node.init) {
        about.type = about.value = node.init.type;
    }
    // like 'var a;'
    else {
        about.type = 'undefined';
        // XXX old parser does this, but for 'const a', I think it uses 'undefined'...
        // is that a bug, or should we match that behavior?
        about.value = node.id.name;
    }

    return about;
};

/**
 * @todo docs
 * @private
 */
AboutNode[SYNTAX.ExpressionStatement] = function(node, about) {
    // like 'MyClass.prototype.myMethod = function() {};' or
    // 'MyNamespace.ChildNamespace.myMethod = function() {};'
    // TODO

    // like 'MyClass.prototype.myMethod = <value>;' or
    // 'MyNamespace.ChildNamespace.myMethod = <value>';
    // TODO

    return about;
};

/**
 * @todo docs
 * @private
 */
AboutNode[SYNTAX.AssignmentExpression] = function(node, about) {
    // TODO: there are complex cases that this isn't handling correctly
    // e.g.:
    /*
        var Bleh = {
          Blurg: {
            Blang: {
              Bling: undefined
            }
          }
        };

        // and this is the AssignmentExpression:
        Bleh.Blurg.Blang.Bling.blarg = function() {};
     */
    
    // TODO: what's an example for this simple case?
    about.name = node.id.name;
    about.type = node.init.type;
    about.value = node.init.value;

    return about;
};

/**
 * @todo docs
 * @private
 */
AboutNode[SYNTAX.Property] = function(node, about) {
    // TODO: visitNode should check for value === SYNTAX.AssignmentExpression and handle that
    // specially
    about.name = node.key.name;
    about.type = node.kind === ('get' || 'set') ? SYNTAX.AssignmentExpression : node.value.type;
    about.value = node.value.type === SYNTAX.FunctionExpression ? node.value.type
        : node.value.value;

    return about;
};


/**
 * @todo docs
 * @class
 * @memberof module:jsdoc/src/visitor
 */
var Visitor = module.exports = function(filename, parser) {
    this.filename = filename;
    this.parser = parser;
};

/**
 * @todo docs
 * @private
 */
Visitor.prototype._makeEvent = function(node, extras) {
    var _  = require('underscore');

    extras = extras || {};

    var defaults = {
        id: node.uid,
        comment: node.leadingComments && node.leadingComments.length ?
            node.leadingComments[node.leadingComments.length - 1].raw :
            '@undocumented',
        lineno: node.loc.start.line,
        filename: this.filename,
        // TODO: leaving out astnode because it's redundant with code.node; is that ok?
        code: AboutNode[node.type](node, {}),
        event: 'symbolFound',
        finishers: [this.parser.addDocletRef]
    };

    return _.defaults(extras, defaults);
};

/**
 * @todo docs
 */
Visitor.prototype[SYNTAX.AssignmentExpression] = function(node) {
    var e = this._makeEvent(node);

    var basename = this.parser.getBasename(e.code.name);
    if (basename !== 'this') {
        e.code.funcscope = this.parser.resolveVar(node, basename);
    }

    return e;
};

/**
 * assignment within an object literal
 * @todo docs
 */
Visitor.prototype[SYNTAX.Property] = function(node) {
    var extras = {};

    // don't try to resolve enums for getters/setters
    if ( node.kind !== ('get' || 'set') ) {
        extras.finishers = [this.parser.addDocletRef, this.parser.resolveEnum];
    }

    return this._makeEvent(node, extras);
};

/**
 * @todo docs
 */
Visitor.prototype[SYNTAX.VariableDeclarator] = function(node) {
    // If this is the first VariableDeclarator, attach the VariableDeclaration's leading comments
    // to the node. For example, this block comment should be attached to the 'a' declarator:
    //
    //     /** Var a. */
    //     var a = 0, b = 1, c = 2;
    if (node.parent.declarations[0] === node && node.parent.leadingComments) {
        node.leadingComments = node.parent.leadingComments.slice(0);
        node.parent.leadingComments = undefined;
    }

    var e = this._makeEvent(node);

    this.parser._trackVars(node, e);

    return e;
};

/**
 * @todo docs
 */
Visitor.prototype[SYNTAX.FunctionDeclaration] = function(node) {
    var e = this._makeEvent(node);

    this.parser._trackVars(node, e);

    var basename = this.parser._getBasename(e.code.name);
    e.code.funcscope = this.parser.resolveVar(node, basename);

    return e;
};

/**
 * @todo docs
 */
Visitor.prototype[SYNTAX.FunctionExpression] = Visitor.prototype[SYNTAX.FunctionDeclaration];

/**
 * @todo docs
 */
Visitor.prototype.visit = function(node) {
    var e = {
        finishers: []
    };
    var i;
    var l;

    if (this[node.type]) {
        e = this[node.type](node);
    }

    for (i = 0, l = this.parser._visitors.length; i < l; i++) {
        this.parser._visitors[i].visitNode(node, e, this.parser, this.filename);
        if (e.stopPropagation) {
            break;
        }
    }

    if (!e.preventDefault) {
        this.parser.emit(e.event, e, this.parser);
    }

    for (i = 0, l = e.finishers.length; i < l; i++) {
        e.finishers[i].call(this.parser, e);
    }

    return true;
};
