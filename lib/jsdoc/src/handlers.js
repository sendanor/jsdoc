/**
 * @module jsdoc/src/handlers
 */

// TODO: at most, this should be stored per source file (and ideally not even that)
var currentModule = null;

/**
    Attach these event handlers to a particular instance of a parser.
    @param parser
 */
exports.attachTo = function(parser) {
    var Doclet = require('jsdoc/doclet').Doclet;

    // handles JSDoc comments that include a @name tag -- the code is ignored in such a case
    parser.on('jsdocCommentFound', function(e) {
        var doclet = new Doclet(e.comment, e);

        if (!doclet.name) {
            return false; // only interested in virtual comments (with a @name) here
        }

        addDoclet.call(this, doclet);
        if (doclet.kind === 'module') {
            currentModule = doclet.longname;
        }
        e.doclet = doclet;
    });

    // handles named symbols in the code, may or may not have a JSDoc comment attached
    parser.on('symbolFound', function(e) {
        var subDoclets = e.comment.split(/@also\b/g);

        for (var i = 0, l = subDoclets.length; i < l; i++) {
            newSymbolDoclet.call(this, subDoclets[i], e);
        }
    });

    function newSymbolDoclet(docletSrc, e) {
        var memberofName = null;
        var doclet = new Doclet(docletSrc, e);

        // an undocumented symbol right after a virtual comment? rhino mistakenly connected the two
        if (doclet.name) { // there was a @name in comment
            // try again, without the comment
            e.comment = '@undocumented';
            doclet = new Doclet(e.comment, e);
        }

        if (doclet.alias) {
            if (doclet.alias === '{@thisClass}') {
                memberofName = this.resolveThis(e.astnode);

                // "class" refers to the owner of the prototype, not the prototype itself
                if ( /^(.+?)(\.prototype|#)$/.test(memberofName) ) {
                    memberofName = RegExp.$1;
                }
                doclet.alias = memberofName;
            }
            doclet.addTag('name', doclet.alias);
            doclet.postProcess();
        }
        else if (e.code && e.code.name) { // we need to get the symbol name from code
            doclet.addTag('name', e.code.name);
            if (!doclet.memberof && e.astnode) {
                var basename = null,
                    scope = '';
                if ( /^((module.)?exports|this)(\.|$)/.test(doclet.name) ) {
                    var nameStartsWith = RegExp.$1;

                    doclet.name = doclet.name.replace(/^(exports|this)(\.|$)/, '');

                    // like /** @module foo */ exports.bar = 1;
                    if (nameStartsWith === 'exports' && currentModule) {
                        memberofName = currentModule;
                        scope = 'static';
                    }
                    else if (doclet.name === 'module.exports' && currentModule) {
                        doclet.addTag('name', currentModule);
                        doclet.postProcess();
                    }
                    else {
                        // like /** @module foo */ exports = {bar: 1};
                        // or /** blah */ this.foo = 1;
                        memberofName = this.resolveThis(e.astnode);
                        scope = nameStartsWith === 'exports'? 'static' : 'instance';

                        // like /** @module foo */ this.bar = 1;
                        if (nameStartsWith === 'this' && currentModule && !memberofName) {
                            memberofName = currentModule;
                            scope = 'static';
                        }
                    }

                    if (memberofName) {
                        if (doclet.name) {
                            doclet.name = memberofName + (scope === 'instance' ? '#' : '.') +
                                doclet.name;
                        }
                        else {
                            doclet.name = memberofName;
                        }
                    }
                }
                else {
                    memberofName = this.astnodeToMemberof(e.astnode);
                    if(memberofName instanceof Array) {
                        basename = memberofName[1];
                        memberofName = memberofName[0];
                    }
                }

                if (memberofName) {
                    doclet.addTag( 'memberof', memberofName);
                    if (basename) {
                        doclet.name = doclet.name.replace(new RegExp('^' + RegExp.escape(basename) + '.'), '');
                    }
                }
                else {
                    if (currentModule) {
                        if (!doclet.scope) {
                            doclet.addTag( 'inner');
                        }
                        if (!doclet.memberof && doclet.scope !== 'global') {
                            doclet.addTag( 'memberof', currentModule);
                        }
                    }
                }
            }

            doclet.postProcess();
        }
        else {
            return false;
        }

        if (!doclet.memberof) {
            doclet.scope = 'global';
        }

        addDoclet.call(this, doclet);
        e.doclet = doclet;
    }

    parser.on('fileComplete', function(e) {
        currentModule = null;
    });

    function addDoclet(doclet) {
        var e;
        if (doclet) {
            e = {
                doclet: doclet
            };
            this.emit('newDoclet', e);

            if ( !e.defaultPrevented && !filter(doclet) ) {
                this.addResult(doclet);
            }
        }
    }

    function filter(doclet) {
        // you can't document prototypes
        if ( /#$/.test(doclet.longname) ) {
            return true;
        }
        // you can't document symbols added by the parser with a dummy name
        if (doclet.meta.code && doclet.meta.code.name === '____') {
            return true;
        }

        return false;
    }
};
