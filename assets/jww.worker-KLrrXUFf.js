(function(){var e=new URL(`ezjww_wasm_bg-Bqp-YxaL.wasm`,self.location.href).href;let t={0:[1189,841],1:[841,594],2:[594,420],3:[420,297],4:[297,210]},n=Math.PI/18,r=[1,0,0,1,0,0],i=(e,t,n)=>({x:e[0]*t+e[2]*n+e[4],y:e[1]*t+e[3]*n+e[5]}),a=(e,t)=>[e[0]*t[0]+e[2]*t[1],e[1]*t[0]+e[3]*t[1],e[0]*t[2]+e[2]*t[3],e[1]*t[2]+e[3]*t[3],e[0]*t[4]+e[2]*t[5]+e[4],e[1]*t[4]+e[3]*t[5]+e[5]],o=(...e)=>e.every(e=>typeof e==`number`&&Number.isFinite(e)),s=e=>e*180/Math.PI;function c(e){let c=[],u=[],d=/* @__PURE__ */ new Map,f=new Map(e.block_defs.map(e=>[e.number,e.entities])),p=e.header.layer_groups,m=e=>{let t=p[e.layer_group];return!t||t.state!==0&&t.layers[e.layer]?.state!==0},h=e=>{if(c.length>=4e5)throw Error(`図面が大きすぎます（線が多すぎます）。Jw_cad で必要な範囲だけにして保存し直してください`);c.push(e)},g=(e,t)=>{if(!t||!o(t.start_x,t.start_y,t.end_x,t.end_y))return 0;let n=i(e,t.start_x,t.start_y),r=i(e,t.end_x,t.end_y);return h({x1:n.x,y1:n.y,x2:r.x,y2:r.y}),1},_=(e,t)=>{if(!t||!o(t.start_x,t.start_y,t.size_y)||typeof t.content!=`string`)return 0;let n=t.content.trim();if(!n||n.startsWith(`^@BM`))return 0;let r=i(e,t.start_x,t.start_y),a=Math.hypot(e[0],e[1])||1,c=Math.hypot(e[2],e[3])||1,l=s(Math.atan2(e[1],e[0])),d=o(t.size_x)?t.size_x:t.size_y;return u.push({x:r.x,y:r.y,h:t.size_y*c,w:d*a,angle:(o(t.angle)?t.angle:0)+l,content:n}),1},v=(e,t)=>{if(!o(t.center_x,t.center_y,t.radius)||!(t.radius>0))return 0;let r=t.is_full_circle??t.type===`CIRCLE`,a=r?0:o(t.start_angle)?t.start_angle:0,s=r?Math.PI*2:o(t.arc_angle)?t.arc_angle:0;if(s===0)return 0;let c=o(t.flatness)&&t.flatness>0?t.flatness:1,l=o(t.tilt_angle)?t.tilt_angle:0,u=Math.cos(l),d=Math.sin(l),f=Math.min(360,Math.max(4,Math.ceil(Math.abs(s)/n))),p=n=>{let r=a+s*n/f,o=t.radius*Math.cos(r),l=t.radius*c*Math.sin(r);return i(e,t.center_x+o*u-l*d,t.center_y+o*d+l*u)},m=p(0);for(let e=1;e<=f;e++){let t=p(e);h({x1:m.x,y1:m.y,x2:t.x,y2:t.y}),m=t}return 1},y=(e,t,n,r)=>{let i=0;for(let s of e){if(!s?.base||s.base.pen_style===9||n===0&&!m(s.base))continue;let e=0;switch(s.type){case`LINE`:e=g(t,s);break;case`ARC`:case`CIRCLE`:e=v(t,s);break;case`TEXT`:e=_(t,s);break;case`DIMENSION`:e=g(t,s.line)+_(t,s.text);for(let n of s.aux_lines??[])e+=g(t,n);break;case`BLOCK`:{let i=f.get(s.def_number??NaN);if(!i||n>=8||r.includes(s.def_number)||!o(s.ref_x,s.ref_y))break;let c=o(s.scale_x)&&s.scale_x!==0?s.scale_x:1,l=o(s.scale_y)&&s.scale_y!==0?s.scale_y:1,u=o(s.rotation)?s.rotation:0,d=Math.cos(u),p=Math.sin(u);e=y(i,a(t,[d*c,p*c,-p*l,d*l,s.ref_x,s.ref_y]),n+1,[...r,s.def_number]);break}}i+=e,n===0&&e&&d.set(s.base.layer_group,(d.get(s.base.layer_group)??0)+e)}return i};y(e.entities,r,0,[]);let b=e=>{let t=p[e]?.scale;return o(t)&&t>0?t:1},x=1,S=-1;for(let[e,t]of d)t>S&&(S=t,x=b(e));let C=[...new Set([...d.keys()].map(b))].sort((e,t)=>e-t),w=[];return C.length>1&&w.push(`縮尺の違う図が混ざっています（${C.map(e=>`1/${e}`).join(`・`)}）。図形の多い 1/${x} に合わせました。寸法が合わないときは「2点で縮尺」で直してください`),{lines:c,texts:u,bounds:l(c,u,t[e.header.paper_size]),scale:x,scales:C,notes:w,empty:c.length+u.length===0}}function l(e,t,n){let r=[];for(let t of e)r.push([t.x1,t.y1],[t.x2,t.y2]);for(let e of t){let t=e.angle*Math.PI/180,n=[...e.content].length*e.w;r.push([e.x,e.y],[e.x+Math.cos(t)*n,e.y+Math.sin(t)*n],[e.x-Math.sin(t)*e.h,e.y+Math.cos(t)*e.h])}let i=e=>{if(!e.length)return null;let t={minX:1/0,minY:1/0,maxX:-1/0,maxY:-1/0};for(let[n,r]of e)n<t.minX&&(t.minX=n),n>t.maxX&&(t.maxX=n),r<t.minY&&(t.minY=r),r>t.maxY&&(t.maxY=r);return t};if(n){let e=n[0]/2*1.25,t=n[1]/2*1.25,a=r.filter(([n,r])=>Math.abs(n)<=e&&Math.abs(r)<=t);if(a.length>=r.length*.9){let e=i(a);if(e)return e}}return i(r)??{minX:0,minY:0,maxX:0,maxY:0}}let u=null;function d(){return u??=(async()=>{let t=await fetch(e);if(!t.ok)throw Error(`図面を読む部品を読み込めませんでした`);let n=new Uint8Array(await t.arrayBuffer()),r={};return Function(`exports`,`require`,`__dirname`,`/* @ts-self-types="./ezjww_wasm.d.ts" */

/**
 * @param {Uint8Array} data
 * @returns {any}
 */
function detectFileFormat(data) {
    const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.detectFileFormat(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}
exports.detectFileFormat = detectFileFormat;

/**
 * Parse a \`^@BM\` image placement text; \`null\` when the text is not one.
 * @param {string} content
 * @returns {any}
 */
function imageReference(content) {
    const ptr0 = passStringToWasm0(content, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.imageReference(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}
exports.imageReference = imageReference;

/**
 * Build a \`^@BM\` image placement text; \`extra\` defaults to Jw_cad's parameters.
 * @param {string} path
 * @param {number} width
 * @param {number} height
 * @param {any} extra
 * @returns {string}
 */
function imageReferenceContent(path, width, height, extra) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(path, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.imageReferenceContent(ptr0, len0, width, height, extra);
        var ptr2 = ret[0];
        var len2 = ret[1];
        if (ret[3]) {
            ptr2 = 0; len2 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred3_0 = ptr2;
        deferred3_1 = len2;
        return getStringFromWasm0(ptr2, len2);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}
exports.imageReferenceContent = imageReferenceContent;

/**
 * @param {Uint8Array} data
 * @returns {boolean}
 */
function isJwcFile(data) {
    const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.isJwcFile(ptr0, len0);
    return ret !== 0;
}
exports.isJwcFile = isJwcFile;

/**
 * @param {Uint8Array} data
 * @returns {boolean}
 */
function isJwsFile(data) {
    const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.isJwsFile(ptr0, len0);
    return ret !== 0;
}
exports.isJwsFile = isJwsFile;

/**
 * @param {Uint8Array} data
 * @returns {boolean}
 */
function isJwwFile(data) {
    const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.isJwwFile(ptr0, len0);
    return ret !== 0;
}
exports.isJwwFile = isJwwFile;

/**
 * @returns {any}
 */
function newJwwDocument() {
    const ret = wasm.newJwwDocument();
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}
exports.newJwwDocument = newJwwDocument;

/**
 * @param {Uint8Array} data
 * @returns {any}
 */
function readCadDocument(data) {
    const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.readCadDocument(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}
exports.readCadDocument = readCadDocument;

/**
 * @param {Uint8Array} data
 * @returns {any}
 */
function readDocument(data) {
    const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.readDocument(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}
exports.readDocument = readDocument;

/**
 * @param {Uint8Array} data
 * @param {boolean} explode_inserts
 * @param {number} max_block_nesting
 * @param {string | null} [jwc_coordinates]
 * @param {number | null} [text_em_scale]
 * @returns {any}
 */
function readDxfDocument(data, explode_inserts, max_block_nesting, jwc_coordinates, text_em_scale) {
    const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    var ptr1 = isLikeNone(jwc_coordinates) ? 0 : passStringToWasm0(jwc_coordinates, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len1 = WASM_VECTOR_LEN;
    const ret = wasm.readDxfDocument(ptr0, len0, explode_inserts, max_block_nesting, ptr1, len1, !isLikeNone(text_em_scale), isLikeNone(text_em_scale) ? 0 : text_em_scale);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}
exports.readDxfDocument = readDxfDocument;

/**
 * @param {Uint8Array} data
 * @param {boolean} explode_inserts
 * @param {number} max_block_nesting
 * @param {string | null} [jwc_coordinates]
 * @param {string | null} [target_version]
 * @param {number | null} [text_em_scale]
 * @returns {string}
 */
function readDxfString(data, explode_inserts, max_block_nesting, jwc_coordinates, target_version, text_em_scale) {
    let deferred5_0;
    let deferred5_1;
    try {
        const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        var ptr1 = isLikeNone(jwc_coordinates) ? 0 : passStringToWasm0(jwc_coordinates, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len1 = WASM_VECTOR_LEN;
        var ptr2 = isLikeNone(target_version) ? 0 : passStringToWasm0(target_version, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len2 = WASM_VECTOR_LEN;
        const ret = wasm.readDxfString(ptr0, len0, explode_inserts, max_block_nesting, ptr1, len1, ptr2, len2, !isLikeNone(text_em_scale), isLikeNone(text_em_scale) ? 0 : text_em_scale);
        var ptr4 = ret[0];
        var len4 = ret[1];
        if (ret[3]) {
            ptr4 = 0; len4 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred5_0 = ptr4;
        deferred5_1 = len4;
        return getStringFromWasm0(ptr4, len4);
    } finally {
        wasm.__wbindgen_free(deferred5_0, deferred5_1, 1);
    }
}
exports.readDxfString = readDxfString;

/**
 * @param {Uint8Array} data
 * @returns {any}
 */
function readHeader(data) {
    const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.readHeader(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}
exports.readHeader = readHeader;

/**
 * @param {Uint8Array} data
 * @returns {any}
 */
function readJwcDocument(data) {
    const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.readJwcDocument(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}
exports.readJwcDocument = readJwcDocument;

/**
 * @param {Uint8Array} data
 * @returns {any}
 */
function readJwcHeader(data) {
    const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.readJwcHeader(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}
exports.readJwcHeader = readJwcHeader;

/**
 * @param {Uint8Array} data
 * @returns {any}
 */
function readJwsDocument(data) {
    const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.readJwsDocument(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}
exports.readJwsDocument = readJwsDocument;

/**
 * @param {Uint8Array} data
 * @returns {any}
 */
function readJwsHeader(data) {
    const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.readJwsHeader(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}
exports.readJwsHeader = readJwsHeader;

/**
 * @param {any} document
 * @returns {Uint8Array}
 */
function toJwwBytes(document) {
    const ret = wasm.toJwwBytes(document);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v1;
}
exports.toJwwBytes = toJwwBytes;

/**
 * @param {any} document
 * @param {boolean | null} [skip_unsupported]
 * @returns {any}
 */
function toWriteDocument(document, skip_unsupported) {
    const ret = wasm.toWriteDocument(document, isLikeNone(skip_unsupported) ? 0xFFFFFF : skip_unsupported ? 1 : 0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}
exports.toWriteDocument = toWriteDocument;
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg_Error_ef53bc310eb298a0: function(arg0, arg1) {
            const ret = Error(getStringFromWasm0(arg0, arg1));
            return ret;
        },
        __wbg_String_8564e559799eccda: function(arg0, arg1) {
            const ret = String(arg1);
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg___wbindgen_boolean_get_1a45e2c38d4d41b9: function(arg0) {
            const v = arg0;
            const ret = typeof(v) === 'boolean' ? v : undefined;
            return isLikeNone(ret) ? 0xFFFFFF : ret ? 1 : 0;
        },
        __wbg___wbindgen_debug_string_0accd80f45e5faa2: function(arg0, arg1) {
            const ret = debugString(arg1);
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg___wbindgen_is_function_754e9f305ff6029e: function(arg0) {
            const ret = typeof(arg0) === 'function';
            return ret;
        },
        __wbg___wbindgen_is_null_87c3bfe968c6a5ad: function(arg0) {
            const ret = arg0 === null;
            return ret;
        },
        __wbg___wbindgen_is_object_56732c2bc353f41d: function(arg0) {
            const val = arg0;
            const ret = typeof(val) === 'object' && val !== null;
            return ret;
        },
        __wbg___wbindgen_is_string_c236cabd84a4d769: function(arg0) {
            const ret = typeof(arg0) === 'string';
            return ret;
        },
        __wbg___wbindgen_is_undefined_67b456be8673d3d7: function(arg0) {
            const ret = arg0 === undefined;
            return ret;
        },
        __wbg___wbindgen_jsval_eq_1068e624fa87f6ab: function(arg0, arg1) {
            const ret = arg0 === arg1;
            return ret;
        },
        __wbg___wbindgen_jsval_loose_eq_2c56564c75129511: function(arg0, arg1) {
            const ret = arg0 == arg1;
            return ret;
        },
        __wbg___wbindgen_number_get_9bb1761122181af2: function(arg0, arg1) {
            const obj = arg1;
            const ret = typeof(obj) === 'number' ? obj : undefined;
            getDataViewMemory0().setFloat64(arg0 + 8 * 1, isLikeNone(ret) ? 0 : ret, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, !isLikeNone(ret), true);
        },
        __wbg___wbindgen_string_get_72bdf95d3ae505b1: function(arg0, arg1) {
            const obj = arg1;
            const ret = typeof(obj) === 'string' ? obj : undefined;
            var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            var len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg___wbindgen_throw_1506f2235d1bdba0: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbg_call_8a89609d89f6608a: function() { return handleError(function (arg0, arg1) {
            const ret = arg0.call(arg1);
            return ret;
        }, arguments); },
        __wbg_done_60cf307fcc680536: function(arg0) {
            const ret = arg0.done;
            return ret;
        },
        __wbg_get_1f8f054ddbaa7db2: function() { return handleError(function (arg0, arg1) {
            const ret = Reflect.get(arg0, arg1);
            return ret;
        }, arguments); },
        __wbg_get_2b48c7d0d006a781: function(arg0, arg1) {
            const ret = arg0[arg1 >>> 0];
            return ret;
        },
        __wbg_get_de6a0f7d4d18a304: function() { return handleError(function (arg0, arg1) {
            const ret = Reflect.get(arg0, arg1);
            return ret;
        }, arguments); },
        __wbg_get_unchecked_33f6e5c9e2f2d6b2: function(arg0, arg1) {
            const ret = arg0[arg1 >>> 0];
            return ret;
        },
        __wbg_instanceof_ArrayBuffer_8f49811467741499: function(arg0) {
            let result;
            try {
                result = arg0 instanceof ArrayBuffer;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_Uint8Array_86f30649f63ef9c2: function(arg0) {
            let result;
            try {
                result = arg0 instanceof Uint8Array;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_isArray_67c2c9c4313f4448: function(arg0) {
            const ret = Array.isArray(arg0);
            return ret;
        },
        __wbg_iterator_8732428d309e270e: function() {
            const ret = Symbol.iterator;
            return ret;
        },
        __wbg_length_4a591ecaa01354d9: function(arg0) {
            const ret = arg0.length;
            return ret;
        },
        __wbg_length_66f1a4b2e9026940: function(arg0) {
            const ret = arg0.length;
            return ret;
        },
        __wbg_new_578aeef4b6b94378: function(arg0) {
            const ret = new Uint8Array(arg0);
            return ret;
        },
        __wbg_new_622fc80556be2e26: function() {
            const ret = new Map();
            return ret;
        },
        __wbg_new_ce1ab61c1c2b300d: function() {
            const ret = new Object();
            return ret;
        },
        __wbg_new_d90091b82fdf5b91: function() {
            const ret = new Array();
            return ret;
        },
        __wbg_next_9e03acdf51c4960d: function(arg0) {
            const ret = arg0.next;
            return ret;
        },
        __wbg_next_eb8ca7351fa27906: function() { return handleError(function (arg0) {
            const ret = arg0.next();
            return ret;
        }, arguments); },
        __wbg_ownKeys_0587b8fe286a40e6: function() { return handleError(function (arg0) {
            const ret = Reflect.ownKeys(arg0);
            return ret;
        }, arguments); },
        __wbg_prototypesetcall_3249fc62a0fafa30: function(arg0, arg1, arg2) {
            Uint8Array.prototype.set.call(getArrayU8FromWasm0(arg0, arg1), arg2);
        },
        __wbg_set_52b1e1eb5bed906a: function(arg0, arg1, arg2) {
            const ret = arg0.set(arg1, arg2);
            return ret;
        },
        __wbg_set_6be42768c690e380: function(arg0, arg1, arg2) {
            arg0[arg1] = arg2;
        },
        __wbg_set_dca99999bba88a9a: function(arg0, arg1, arg2) {
            arg0[arg1 >>> 0] = arg2;
        },
        __wbg_value_f3625092ee4b37f4: function(arg0) {
            const ret = arg0.value;
            return ret;
        },
        __wbindgen_cast_0000000000000001: function(arg0) {
            // Cast intrinsic for \`F64 -> Externref\`.
            const ret = arg0;
            return ret;
        },
        __wbindgen_cast_0000000000000002: function(arg0) {
            // Cast intrinsic for \`I64 -> Externref\`.
            const ret = arg0;
            return ret;
        },
        __wbindgen_cast_0000000000000003: function(arg0, arg1) {
            // Cast intrinsic for \`Ref(String) -> Externref\`.
            const ret = getStringFromWasm0(arg0, arg1);
            return ret;
        },
        __wbindgen_cast_0000000000000004: function(arg0) {
            // Cast intrinsic for \`U64 -> Externref\`.
            const ret = BigInt.asUintN(64, arg0);
            return ret;
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },
    };
    return {
        __proto__: null,
        "./ezjww_wasm_bg.js": import0,
    };
}

function addToExternrefTable0(obj) {
    const idx = wasm.__externref_table_alloc();
    wasm.__wbindgen_externrefs.set(idx, obj);
    return idx;
}

function debugString(val) {
    // primitive types
    const type = typeof val;
    if (type == 'number' || type == 'boolean' || val == null) {
        return  \`\${val}\`;
    }
    if (type == 'string') {
        return \`"\${val}"\`;
    }
    if (type == 'symbol') {
        const description = val.description;
        if (description == null) {
            return 'Symbol';
        } else {
            return \`Symbol(\${description})\`;
        }
    }
    if (type == 'function') {
        const name = val.name;
        if (typeof name == 'string' && name.length > 0) {
            return \`Function(\${name})\`;
        } else {
            return 'Function';
        }
    }
    // objects
    if (Array.isArray(val)) {
        const length = val.length;
        let debug = '[';
        if (length > 0) {
            debug += debugString(val[0]);
        }
        for(let i = 1; i < length; i++) {
            debug += ', ' + debugString(val[i]);
        }
        debug += ']';
        return debug;
    }
    // Test for built-in
    const builtInMatches = /\\[object ([^\\]]+)\\]/.exec(toString.call(val));
    let className;
    if (builtInMatches && builtInMatches.length > 1) {
        className = builtInMatches[1];
    } else {
        // Failed to match the standard '[object ClassName]'
        return toString.call(val);
    }
    if (className == 'Object') {
        // we're a user defined class or Object
        // JSON.stringify avoids problems with cycles, and is generally much
        // easier than looping through ownProperties of \`val\`.
        try {
            return 'Object(' + JSON.stringify(val) + ')';
        } catch (_) {
            return 'Object';
        }
    }
    // errors
    if (val instanceof Error) {
        return \`\${val.name}: \${val.message}\\n\${val.stack}\`;
    }
    // TODO we could test for more things here, like \`Set\`s and \`Map\`s.
    return className;
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedDataViewMemory0 = null;
function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || (cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.memory.buffer)) {
        cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
}

function getStringFromWasm0(ptr, len) {
    return decodeText(ptr >>> 0, len);
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function handleError(f, args) {
    try {
        return f.apply(this, args);
    } catch (e) {
        const idx = addToExternrefTable0(e);
        wasm.__wbindgen_exn_store(idx);
    }
}

function isLikeNone(x) {
    return x === undefined || x === null;
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

function takeFromExternrefTable0(idx) {
    const value = wasm.__wbindgen_externrefs.get(idx);
    wasm.__externref_table_dealloc(idx);
    return value;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
function decodeText(ptr, len) {
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;

const wasmPath = \`\${__dirname}/ezjww_wasm_bg.wasm\`;
const wasmBytes = require('fs').readFileSync(wasmPath);
const wasmModule = new WebAssembly.Module(wasmBytes);
let wasmInstance = new WebAssembly.Instance(wasmModule, __wbg_get_imports());
let wasm = wasmInstance.exports;
wasm.__wbindgen_start();
`)(r,()=>({readFileSync:()=>n}),``),r})(),u}let f={jwc:`JWC 形式（古い Jw_cad）には対応していません。Jw_cad で開いて .jww で保存し直してください`,jws:`JWS（図形ファイル）には対応していません。図面（.jww）を選んでください`};self.onmessage=async e=>{let t;try{let n=await d(),r=new Uint8Array(e.data.data),i=n.detectFileFormat(r);t=i===`jww`?{ok:!0,drawing:c(n.readDocument(r))}:{ok:!1,error:f[i??``]??`Jw_cad の図面（.jww）ではないようです`}}catch(e){t={ok:!1,error:`図面を解析できませんでした（${e instanceof Error?e.message:String(e)}）`}}self.postMessage(t)}})();