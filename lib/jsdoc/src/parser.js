/*global env: true */
/**
 * @module jsdoc/src/parser
 */

var hasOwnProp = Object.prototype.hasOwnProperty;

const COMMENT_TYPES = {
    Block: 'Block',
    Line: 'Line'
};
const SYNTAX = require('esprima').Syntax;

// starting value for unique IDs; defined here so that values remain unique for the life of the VM
var id = 10000000;

function nextId() {
    return 'astnode' + id++;
}

/**
 * @class
 * @memberof module:jsdoc/src/parser.Parser
 * @mixes module:events
 *
 * @example <caption>Create a new parser.</caption>
 * var jsdocParser = new (require('jsdoc/src/parser').Parser)();
 */
var Parser = exports.Parser = function() {
    // Initialize a global ref to store global members
    this.refs = {
        __global__: {
            meta: {}
        }
    };

    this._resultBuffer = [];
    this._visitors = [];
};
Parser.prototype = Object.create( require('events').EventEmitter.prototype );

/**
 * Parse the given source files for JSDoc comments.
 * @todo improve docs
 *
 * @param {Array.<string>} sourceFiles An array of filepaths to the JavaScript sources.
 * @param {string} [encoding=utf8]
 *
 * @fires jsdocCommentFound
 * @fires symbolFound
 * @fires newDoclet
 * @fires fileBegin
 * @fires fileComplete
 *
 * @example <caption>Parse two source files.</caption>
 * var myFiles = ['file1.js', 'file2.js'];
 * var docs = jsdocParser.parse(myFiles);
 */
Parser.prototype.parse = function(sourceFiles, encoding) {
    var fs = require('jsdoc/fs');
    var handleError = require('jsdoc/util/error').handle;
    var util = require('util');

    var filename = '';
    const SCHEMA = 'javascript:';
    var sourceCode = '';

    encoding = encoding || env.conf.encoding || 'utf8';

    if (typeof sourceFiles === 'string') {
        sourceFiles = [sourceFiles];
    }

    for (var i = 0, l = sourceFiles.length; i < l; i++) {
        if (sourceFiles[i].indexOf(SCHEMA) === 0) {
            sourceCode = sourceFiles[i].substr(SCHEMA.length);
            filename = '[[string' + i + ']]';
        }
        else {
            filename = sourceFiles[i];
            try {
                sourceCode = fs.readFileSync(filename, encoding);
            }
            catch(e) {
                var err = new Error( util.format('Unable to parse %s: %s', filename, e.message) );
                handleError(err);
                continue;
            }
        }

        // TODO: move to try/catch block
        this._parseSourceCode(sourceCode, filename);
    }

    return this._resultBuffer;
};

/**
 * @todo docs
 * @returns {Array<Doclet>} The accumulated results of any calls to parse.
 */
Parser.prototype.results = function() {
    return this._resultBuffer;
};

/**
 * @todo docs
 * @param {Object} o The parse result to add to the result buffer.
 */
Parser.prototype.addResult = function(o) {
    this._resultBuffer.push(o);
};

/**
 * @todo docs
 * Empty any accumulated results of calls to parse.
 */
Parser.prototype.clear = function() {
    this._resultBuffer = [];
};

/**
 * @todo docs
 * Adds a node visitor to use in parsing
 */
Parser.prototype.addNodeVisitor = function(visitor) {
    this._visitors.push(visitor);
};

/**
 * @todo docs
 * Get the node visitors used in parsing
 */
Parser.prototype.getVisitors = function() {
    return this._visitors;
};

/**
 * @todo docs
 *
 * @private
 * @param {String} code
 * @return {String}
 */
function pretreat(code) {
    return code
        // convert starbangstar ('/*!*') comments to JSDoc ('/**') comments
        .replace(/\/\*\!\*/g, '/**')

        // merge adjacent doclets
        .replace(/\*\/\/\*\*+/g, '@also')
        // make lent object literals documentable by giving them a dummy name
        .replace(/(\/\*\*[^\*\/]*?[\*\s]*@lends\s(?:[^\*]|\*(?!\/))*\*\/\s*)\{/g, '$1 ____ = {') // like return @lends {
        .replace(/(\/\*\*[^\*\/]*?@lends\b[^\*\/]*?\*\/)(\s*)return(\s*)\{/g, '$2$3 return $1 ____ = {'); // like @lends return {
}

/**
 * @todo docs
 * @private
 */
function nodeToString(node) {
    var str;

    if (!node) {
        return;
    }

    switch(node.type) {
        // like 'Foo.Bar.Baz' or 'Foo.Bar["Baz"]'
        case SYNTAX.MemberExpression:
            str = [nodeToString(node.object), node.property.name || node.property.value].join('.');
            break;

        // like 'var foo'
        case SYNTAX.VariableDeclarator:
            str = node.id.name;
            break;

        // like 'foo'
        case SYNTAX.Identifier:
            str = node.name;
            break;

        // like '"bar"'
        case SYNTAX.Literal:
            str = node.value;
            break;

        // like 'this'
        case SYNTAX.ThisExpression:
            str = 'this';
            break;

        // like '-1' or '-a' or (shudder) '-"a"'
        case SYNTAX.UnaryExpression:
            if (typeof node.argument.value === 'number') {
                // node.argument.value is always decimal, regardless of the original value's radix
                str = parseInt(node.operator + node.argument.value, 10);
            }
            else {
                str = node.operator + node.argument.value;
            }
            break;

        default:
            // TODO: is this correct? what types does this include?
            str = node.type;
    }

    return str;
}

/**
 * @todo docs
 */
var isValidJsdoc = Parser.prototype.isValidJsdoc = function(commentSrc) {
    // '/**' (not '/***'!) + one or more chars + '*/'
    var regexp = /\/\*\*[^\*][\s\S]+\*\//;

    return regexp.test(commentSrc);
};

/**
 * @todo need to update?
 * @todo docs
 */
function makeVarsFinisher(funcDoc) {
    return function(e) {
        // no need to evaluate all things related to funcDoc again, just use it
        if (funcDoc && e.doclet && e.doclet.alias) {
            funcDoc.meta.vars[e.code.name] = e.doclet.longname;
        }
    };
}

/**
 * @todo docs
 *
 * @private
 * @param {String} name - The full symbol name.
 * @return {String} The symbol's basename.
 */
var getBasename = Parser.prototype._getBasename = function(name) {
    if (name) {
        return name.replace(/^([$a-z_][$a-z_0-9]*).*?$/i, '$1');
    }
};

/**
 * @todo docs
 *
 * @private
 */
Parser.prototype._trackVars = function(node, e) {
    // keep track of vars in a function or global scope
    var func = "__global__";
    var funcDoc = null;
    if (node.enclosingFunction) {
        func = node.enclosingFunction.uid;
    }
    funcDoc = this.refs[func];
    if (funcDoc) {
        funcDoc.meta.vars = funcDoc.meta.vars || {};
        funcDoc.meta.vars[e.code.name] = false;
        e.finishers.push(makeVarsFinisher(funcDoc));
    }
};

/**
 * @todo docs
 * @todo will need to modify this to match pending changes in old parser
 *
 * @private
 */
Parser.prototype._fireCommentFound = function(filename, comments) {
    var comment = '';
    var e;

    if (!comments.length) {
        return;
    }

    for (var i = 0, l = comments.length; i < l; i++) {
        comment = comments[i];
        e = {
            comment: comment.raw,
            lineno: comment.loc.start.line,
            filename: filename
        };

        this.emit('jsdocCommentFound', e, this);
    }

    return comments;
};

/**
 * Remove comments from the AST that will not be used to generate documentation. In addition, add
 * the raw comment string for each JSDoc comment.
 *
 * @private
 * @param {Array.<string>} comments - The comments array generated by Esprima.
 * @return {Array.<string>} The updated comments array.
 */
function scrubComments(comments) {
    var comment;
    var commentRaw;
    var result = [];

    for (var i = 0, l = comments.length; i < l; i++) {
        comment = comments[i];
        commentRaw = '/*' + comment.value + '*/';

        // discard line comments and non-JSDoc block comments
        if ( comment.type === COMMENT_TYPES.Block && isValidJsdoc(commentRaw) ) {
            comment.raw = commentRaw;
            result.push(comment);
        }
    }

    return result;
}

/**
 * Check whether two AST nodes are adjacent to each other (separated by no more than one line).
 *
 * @private
 * @param {Object} node1 - The first AST node.
 * @param {Object} node2 - The second AST node.
 * @return {Boolean} Set to `true` if the nodes are adjacent or `false` if they are not adjacent.
 */
function isAdjacent(node1, node2) {
    return node1.loc.end.line - node2.loc.start.line <= 1;
}

/**
 * Find the leading comment, if any, that is adjacent to the first syntax node, then attach that
 * comment to the syntax node. This step is necessary because Escodegen attaches all leading
 * comments to the root node.
 *
 * @private
 * @param {Object} ast - The Esprima AST.
 * @return {Object} The updated AST.
 */
function fixLeadingComments(ast) {
    var comment;
    var i;
    var startNode;

    if (ast.body && ast.body.length && ast.leadingComments && ast.leadingComments.length) {
        startNode = ast.body[0];
        for (i = ast.leadingComments.length; i > 0; i--) {
            comment = ast.leadingComments[i - 1];

            if ( isAdjacent(comment, startNode) ) {
                comment = ast.leadingComments.pop();
                startNode.leadingComments = startNode.leadingComments || [];
                startNode.leadingComments.push(comment);
            }
        }
    }

    return ast;
}

/**
 * Process the parsed comments so they can be used to generate documentation.
 *
 * @private
 * @param {String} filename - The name of the source file.
 * @param {Object} ast - The Esprima AST.
 * @return {Object} The updated AST.
 */
Parser.prototype._processComments = function(filename, ast) {
    var escodegen = require('escodegen');

    // get rid of comments we don't want
    ast.comments = scrubComments(ast.comments);

    // fire an event for each comment
    ast.comments = this._fireCommentFound(filename, ast.comments);

    // necessary until Esprima can attach comments at parse time:
    // https://code.google.com/p/esprima/issues/detail?id=197
    ast = escodegen.attachComments(ast, ast.comments, ast.tokens);

    // improve Escodegen's comment attachment
    ast = fixLeadingComments(ast);

    // remove the tokens; we no longer need them
    ast.tokens = null;

    return ast;
};

/**
 * @todo docs
 *
 * @private
 */
Parser.prototype._parseSourceCode = function(sourceCode, sourceName) {
    var esprima = require('esprima');
    var Visitor = require('jsdoc/src/visitor');
    var Walker = require('jsdoc/src/walker');

    var ast;
    var e = {
        filename: sourceName
    };
    var esprimaOpts = {
        comment: true,
        loc: true,
        range: true,
        tokens: true
    };
    var visitor;
    var walker;

    this.emit('fileBegin', e);

    if (!e.defaultPrevented) {
        e = {
            filename: sourceName,
            source: sourceCode
        };
        this.emit('beforeParse', e);
        sourceCode = pretreat(e.source);
        sourceName = e.filename;

        visitor = new Visitor(sourceName, this);

        ast = esprima.parse(sourceCode, esprimaOpts);
        ast = this._processComments(sourceName, ast);

        walker = new Walker(ast, nextId);
        walker.recurse( visitor.visit.bind(visitor) );
    }

    this.emit('fileComplete', e);
};

/**
 * Given an AST node, determine what the node is a member of.
 *
 * @param {node} node - The AST node.
 * @returns {string} The longname of the node's parent.
 */
Parser.prototype.astnodeToMemberof = function(node) {
    var alias;
    var basename;
    var doclet;
    var scope;
    var uid;

    if ( node.type === (SYNTAX.VariableDeclarator || SYNTAX.FunctionDeclaration ||
        SYNTAX.FunctionExpression) && node.enclosingFunction ) {
        uid = node.enclosingFunction.uid;
        doclet = this.refs[uid];
        if (!doclet) {
            return '<anonymous>~';
        }
        return (doclet.longname || doclet.name) + '~';
    }
    else {
        // check local references for aliases
        // TODO: should this be node.prev?
        basename = getBasename( nodeToString(node.left) );
        scope = node.enclosingFunction;
        while (scope) {
            uid = scope.uid;
            doclet = this.refs[uid];
            if (doclet && doclet.meta.vars && basename in doclet.meta.vars) {
                alias = hasOwnProp.call(doclet.meta.vars, basename) ? doclet.meta.vars[basename]
                    : false;
                if (alias !== false) {
                    // TODO: is it okay that we return an array here?
                    return [alias, basename];
                }
            }
            // move up
            scope = scope.enclosingFunction;
        }

        doclet = this.refs.__global__;
        // TODO: need to add doclet.meta.vars?
        if ( doclet && doclet.meta.vars && hasOwnProp.call(doclet.meta.vars, basename) ) {
            alias = doclet.meta.vars[basename];
            if (alias !== false) {
                // TODO: is it okay that we return an array here?
                return [alias, basename];
            }
        }

        uid = node.parent.uid;
        doclet = this.refs[uid];
        if (!doclet) {
            return ''; // global?
        }
        return doclet.longname || doclet.name;
    }
};

/**
 * Resolve what `this` refers to relative to a node.
 *
 * @param {Object} node - The node whose `this` reference will be resolved.
 * @return {String} The longname of the enclosing node.
 */
Parser.prototype.resolveThis = function(node) {
    var memberof = {};

    // TODO: is SYNTAX.Property correct here?
    if (node.type !== SYNTAX.Property && node.enclosingFunction) {
        // get documentation for the enclosing function
        memberof.uid = node.enclosingFunction.uid;
        memberof.doclet = this.refs[memberof.uid];

        if (!memberof.doclet) {
            return '<anonymous>'; // TODO handle global this?
        }

        if (memberof.doclet['this']) {
            return memberof.doclet['this'];
        }
        // like: Foo.constructor = function(n) { /** blah */ this.name = n; }
        else if (memberof.doclet.kind === 'function' && memberof.doclet.memberof) {
            return memberof.doclet.memberof;
        }
        // walk up to the closest class we can find
        else if ( memberof.doclet.kind === ('class' || 'module') ) {
            return memberof.doclet.longname || memberof.doclet.name;
        }
        else {
            if (node.enclosingFunction){
                return this.resolveThis(node.enclosingFunction/* memberof.doclet.meta.code.val */);
            }
            else {
                return ''; // TODO handle global this?
            }
        }
    }
    else if (node.parent) {
        var parent = node.parent;
        // TODO: is SYNTAX.Property correct here? do we need this step?
        if (parent.type === SYNTAX.property) {
            parent = parent.parent; // go up one more
        }

        memberof.uid = parent.uid;
        memberof.doclet = this.refs[memberof.uid];
        if (!memberof.doclet) {
            return ''; // global?
        }

        return memberof.doclet.longname || memberof.doclet.name;
    }
    else {
        return ''; // global?
    }
};

/**
 * Given: foo = { x: 1 }, find foo from x.
 * @todo docs
 */
Parser.prototype.resolvePropertyParent = function(node) {
    var memberof = {};

    if (node.parent) {
        var parent = node.parent;
        // TODO: is SYNTAX.Property correct here? do we need this step?
        if (parent.type === SYNTAX.Property) {
            parent = parent.parent; // go up one more
        }

        memberof.uid = parent.uid;
        memberof.doclet = this.refs[memberof.uid];

        if (memberof.doclet) {
            return memberof;
        }
    }
};

/**
 * Resolve the function scope for a variable.
 * @todo docs
 *
 * @param {Object} node - The AST node for the variable.
 * @param {string} basename The leftmost name in the long name: in foo.bar.zip the basename is foo.
 */
Parser.prototype.resolveVar = function(node, basename) {
    var doclet;
    var enclosingFunction = node.enclosingFunction;

    if (!enclosingFunction) {
        // global
        return '';
    }
    doclet = this.refs[enclosingFunction.uid];

    if ( doclet && doclet.meta.vars && basename in doclet.meta.vars ) {
        return doclet.longname;
    }

    return this.resolveVar(enclosingFunction, basename);
};

/**
 * @todo docs
 */
Parser.prototype.addDocletRef = function(e) {
    var uid = e.id;
    if (e.doclet) {
        this.refs[uid] = e.doclet; // allow lookup from value => doclet
    }
    // keep references to undocumented anonymous functions too as they might have scoped vars
    else if ( (e.code.type === (SYNTAX.FunctionDeclaration || SYNTAX.FunctionExpression) &&
        !this.refs[uid]) ){
        this.refs[uid] = {
            longname: '<anonymous>',
            meta: {
                code: e.code
            }
        };
    }
};

/**
 * @todo docs
 */
Parser.prototype.resolveEnum = function(e) {
    var doop = require('jsdoc/util/doop').doop;

    var parent = this.resolvePropertyParent(e.code.node);
    if (parent && parent.doclet.isEnum) {
        if (!parent.doclet.properties) {
            parent.doclet.properties = [];
        }
        // members of an enum inherit the enum's type
        if (parent.doclet.type && !e.doclet.type) {
            e.doclet.type = parent.doclet.type;
        }
        // TODO: used to delete this; okay to use null?
        e.doclet.undocumented = null;
        e.doclet.defaultvalue = e.doclet.meta.code.value;
        // add a copy of the doclet to the parent's properties (to avoid circular references)
        parent.doclet.properties.push( doop(e.doclet) );
    }
};

/**
 * Fired whenever the parser encounters a JSDoc comment in the current source code.
 * @event jsdocCommentFound
 * @memberof module:jsdoc/src/parser.Parser
 * @param {event} e
 * @param {string} e.comment The text content of the JSDoc comment
 * @param {number} e.lineno The line number associated with the found comment.
 * @param {string} e.filename The file name associated with the found comment.
 */

/**
 * @todo document all events
 */
