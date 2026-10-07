"""Minimal AVM2 ABC parser + linear pseudo-decompiler.

Usage: python3 -I abcdump.py file.abc outdir
Writes one .as file per class (package path -> dirs) with fields, constants
and method bodies rendered as AS3-like statements (with goto labels for
branches), plus scripts.as for script-level traits.
"""
import os
import struct
import sys


class R:
    def __init__(self, b):
        self.b, self.p = b, 0

    def u8(self):
        v = self.b[self.p]; self.p += 1; return v

    def u16(self):
        v = struct.unpack_from('<H', self.b, self.p)[0]; self.p += 2; return v

    def s24(self):
        b = self.b[self.p:self.p + 3]; self.p += 3
        v = b[0] | (b[1] << 8) | (b[2] << 16)
        return v - (1 << 24) if v & 0x800000 else v

    def u30(self):
        r = 0
        for i in range(5):
            c = self.b[self.p]; self.p += 1
            r |= (c & 0x7f) << (7 * i)
            if not c & 0x80:
                break
        return r & 0xffffffff

    def s32(self):
        v = self.u30()
        return v - (1 << 32) if v & 0x80000000 else v

    def d64(self):
        v = struct.unpack_from('<d', self.b, self.p)[0]; self.p += 8; return v


NS_KIND = {0x08: '', 0x16: '', 0x17: 'internal', 0x18: 'protected', 0x19: 'explicit', 0x1a: 'static protected', 0x05: 'private'}


class Abc:
    def __init__(self, data):
        r = self.r = R(data)
        r.u16(); r.u16()
        n = r.u30(); self.ints = [0] + [r.s32() for _ in range(max(0, n - 1))]
        n = r.u30(); self.uints = [0] + [r.u30() for _ in range(max(0, n - 1))]
        n = r.u30(); self.doubles = [float('nan')] + [r.d64() for _ in range(max(0, n - 1))]
        n = r.u30(); self.strings = ['*']
        for _ in range(max(0, n - 1)):
            ln = r.u30(); self.strings.append(data[r.p:r.p + ln].decode('utf-8', 'replace')); r.p += ln
        n = r.u30(); self.ns = [(0, 0)] + [(r.u8(), r.u30()) for _ in range(max(0, n - 1))]
        n = r.u30(); self.nssets = [[]]
        for _ in range(max(0, n - 1)):
            c = r.u30(); self.nssets.append([r.u30() for _ in range(c)])
        n = r.u30(); self.mn = [None]
        for _ in range(max(0, n - 1)):
            k = r.u8()
            if k in (0x07, 0x0d):
                self.mn.append(('Q', r.u30(), r.u30()))
            elif k in (0x0f, 0x10):
                self.mn.append(('RTQ', r.u30()))
            elif k in (0x11, 0x12):
                self.mn.append(('RTQL',))
            elif k in (0x09, 0x0e):
                self.mn.append(('M', r.u30(), r.u30()))
            elif k in (0x1b, 0x1c):
                self.mn.append(('ML', r.u30()))
            elif k == 0x1d:
                q = r.u30(); c = r.u30(); self.mn.append(('T', q, [r.u30() for _ in range(c)]))
            else:
                raise ValueError('mn kind %x' % k)
        n = r.u30(); self.methods = []
        for _ in range(n):
            pc = r.u30(); ret = r.u30(); pt = [r.u30() for _ in range(pc)]
            name = r.u30(); flags = r.u8(); opts = []; pnames = []
            if flags & 0x08:
                oc = r.u30(); opts = [(r.u30(), r.u8()) for _ in range(oc)]
            if flags & 0x80:
                pnames = [r.u30() for _ in range(pc)]
            self.methods.append(dict(pc=pc, ret=ret, pt=pt, name=name, flags=flags, opts=opts, pnames=pnames, body=None))
        n = r.u30()
        for _ in range(n):
            r.u30(); c = r.u30()
            for _ in range(2 * c):
                r.u30()
        n = r.u30()
        self.instances = []
        for _ in range(n):
            name = r.u30(); sup = r.u30(); fl = r.u8()
            if fl & 0x08:
                r.u30()
            ic = r.u30(); intf = [r.u30() for _ in range(ic)]
            iinit = r.u30(); traits = self.traits()
            self.instances.append(dict(name=name, sup=sup, flags=fl, intf=intf, iinit=iinit, traits=traits))
        self.classes = [dict(cinit=r.u30(), traits=self.traits()) for _ in range(n)]
        n = r.u30(); self.scripts = [dict(init=r.u30(), traits=self.traits()) for _ in range(n)]
        n = r.u30()
        for _ in range(n):
            m = r.u30(); r.u30(); lc = r.u30(); r.u30(); r.u30()
            cl = r.u30(); code = data[r.p:r.p + cl]; r.p += cl
            ec = r.u30(); exc = [tuple(r.u30() for _ in range(5)) for _ in range(ec)]
            self.methods[m]['body'] = dict(code=code, locals=lc, exc=exc, traits=self.traits())

    def traits(self):
        r = self.r; out = []
        for _ in range(r.u30()):
            name = r.u30(); kb = r.u8(); k = kb & 0x0f; t = dict(name=name, kind=k, attr=kb >> 4)
            if k in (0, 6):
                t['slot'] = r.u30(); t['type'] = r.u30(); t['vi'] = r.u30()
                t['vk'] = r.u8() if t['vi'] else None
            elif k in (1, 2, 3):
                r.u30(); t['method'] = r.u30()
            elif k == 4:
                t['slot'] = r.u30(); t['cls'] = r.u30()
            elif k == 5:
                t['slot'] = r.u30(); t['method'] = r.u30()
            if kb & 0x40:
                for _ in range(r.u30()):
                    r.u30()
            out.append(t)
        return out

    # -- names -------------------------------------------------------------
    def nsname(self, i):
        k, s = self.ns[i]
        return self.strings[s] if s else ''

    def qn(self, i, full=False):
        if not i:
            return '*'
        m = self.mn[i]
        if m[0] == 'Q':
            n = self.strings[m[2]] if m[2] else '*'
            if full:
                pkg = self.nsname(m[1])
                return f'{pkg}.{n}' if pkg and self.ns[m[1]][0] in (0x08, 0x16) else n
            return n
        if m[0] in ('RTQ', 'M'):
            return self.strings[m[1]] if m[1] else '*'
        if m[0] == 'T':
            return f'{self.qn(m[1])}.<{",".join(self.qn(p) for p in m[2])}>'
        return '[rt]'

    def const(self, vi, vk):
        if vk is None:
            return None
        if vk == 0x03: return str(self.ints[vi])
        if vk == 0x04: return str(self.uints[vi])
        if vk == 0x06: return repr(self.doubles[vi])
        if vk == 0x01: return S(self.strings[vi])
        if vk == 0x0b: return 'true'
        if vk == 0x0a: return 'false'
        if vk == 0x0c: return 'null'
        if vk == 0x00: return 'undefined'
        return f'ns:{self.nsname(vi)}'


def S(s):
    return '"' + s.replace('\\', '\\\\').replace('"', '\\"').replace('\n', '\\n').replace('\r', '\\r').replace('\0', '\\0') + '"'


# opcode -> (name, operand spec). spec chars: m=multiname s=string i=int u=uint
# d=double n=u30 b=byte(signed) j=s24 branch  N=namespace M=method C=class
OPS = {
    0x01: ('bkpt', ''), 0x02: ('nop', ''), 0x03: ('throw', ''), 0x04: ('getsuper', 'm'), 0x05: ('setsuper', 'm'),
    0x06: ('dxns', 's'), 0x07: ('dxnslate', ''), 0x08: ('kill', 'n'), 0x09: ('label', ''),
    0x0c: ('ifnlt', 'j'), 0x0d: ('ifnle', 'j'), 0x0e: ('ifngt', 'j'), 0x0f: ('ifnge', 'j'), 0x10: ('jump', 'j'),
    0x11: ('iftrue', 'j'), 0x12: ('iffalse', 'j'), 0x13: ('ifeq', 'j'), 0x14: ('ifne', 'j'), 0x15: ('iflt', 'j'),
    0x16: ('ifle', 'j'), 0x17: ('ifgt', 'j'), 0x18: ('ifge', 'j'), 0x19: ('ifstricteq', 'j'), 0x1a: ('ifstrictne', 'j'),
    0x1b: ('lookupswitch', 'L'), 0x1c: ('pushwith', ''), 0x1d: ('popscope', ''), 0x1e: ('nextname', ''),
    0x1f: ('hasnext', ''), 0x20: ('pushnull', ''), 0x21: ('pushundefined', ''), 0x23: ('nextvalue', ''),
    0x24: ('pushbyte', 'b'), 0x25: ('pushshort', 'n'), 0x26: ('pushtrue', ''), 0x27: ('pushfalse', ''),
    0x28: ('pushnan', ''), 0x29: ('pop', ''), 0x2a: ('dup', ''), 0x2b: ('swap', ''), 0x2c: ('pushstring', 's'),
    0x2d: ('pushint', 'i'), 0x2e: ('pushuint', 'u'), 0x2f: ('pushdouble', 'd'), 0x30: ('pushscope', ''),
    0x31: ('pushnamespace', 'N'), 0x32: ('hasnext2', 'nn'),
    0x35: ('li8', ''), 0x36: ('li16', ''), 0x37: ('li32', ''), 0x38: ('lf32', ''), 0x39: ('lf64', ''),
    0x3a: ('si8', ''), 0x3b: ('si16', ''), 0x3c: ('si32', ''), 0x3d: ('sf32', ''), 0x3e: ('sf64', ''),
    0x40: ('newfunction', 'M'), 0x41: ('call', 'n'), 0x42: ('construct', 'n'), 0x43: ('callmethod', 'nn'),
    0x44: ('callstatic', 'Mn'), 0x45: ('callsuper', 'mn'), 0x46: ('callproperty', 'mn'), 0x47: ('returnvoid', ''),
    0x48: ('returnvalue', ''), 0x49: ('constructsuper', 'n'), 0x4a: ('constructprop', 'mn'), 0x4c: ('callproplex', 'mn'),
    0x4e: ('callsupervoid', 'mn'), 0x4f: ('callpropvoid', 'mn'), 0x50: ('sxi1', ''), 0x51: ('sxi8', ''), 0x52: ('sxi16', ''),
    0x53: ('applytype', 'n'), 0x55: ('newobject', 'n'), 0x56: ('newarray', 'n'), 0x57: ('newactivation', ''),
    0x58: ('newclass', 'C'), 0x59: ('getdescendants', 'm'), 0x5a: ('newcatch', 'n'), 0x5d: ('findpropstrict', 'm'),
    0x5e: ('findproperty', 'm'), 0x5f: ('finddef', 'm'), 0x60: ('getlex', 'm'), 0x61: ('setproperty', 'm'),
    0x62: ('getlocal', 'n'), 0x63: ('setlocal', 'n'), 0x64: ('getglobalscope', ''), 0x65: ('getscopeobject', 'n'),
    0x66: ('getproperty', 'm'), 0x67: ('getouterscope', 'n'), 0x68: ('initproperty', 'm'), 0x6a: ('deleteproperty', 'm'),
    0x6c: ('getslot', 'n'), 0x6d: ('setslot', 'n'), 0x6e: ('getglobalslot', 'n'), 0x6f: ('setglobalslot', 'n'),
    0x70: ('convert_s', ''), 0x71: ('esc_xelem', ''), 0x72: ('esc_xattr', ''), 0x73: ('convert_i', ''),
    0x74: ('convert_u', ''), 0x75: ('convert_d', ''), 0x76: ('convert_b', ''), 0x77: ('convert_o', ''),
    0x78: ('checkfilter', ''), 0x80: ('coerce', 'm'), 0x81: ('coerce_b', ''), 0x82: ('coerce_a', ''),
    0x83: ('coerce_i', ''), 0x84: ('coerce_d', ''), 0x85: ('coerce_s', ''), 0x86: ('astype', 'm'),
    0x87: ('astypelate', ''), 0x88: ('coerce_u', ''), 0x89: ('coerce_o', ''), 0x90: ('negate', ''),
    0x91: ('increment', ''), 0x92: ('inclocal', 'n'), 0x93: ('decrement', ''), 0x94: ('declocal', 'n'),
    0x95: ('typeof', ''), 0x96: ('not', ''), 0x97: ('bitnot', ''), 0xa0: ('add', ''), 0xa1: ('subtract', ''),
    0xa2: ('multiply', ''), 0xa3: ('divide', ''), 0xa4: ('modulo', ''), 0xa5: ('lshift', ''), 0xa6: ('rshift', ''),
    0xa7: ('urshift', ''), 0xa8: ('bitand', ''), 0xa9: ('bitor', ''), 0xaa: ('bitxor', ''), 0xab: ('equals', ''),
    0xac: ('strictequals', ''), 0xad: ('lessthan', ''), 0xae: ('lessequals', ''), 0xaf: ('greaterthan', ''),
    0xb0: ('greaterequals', ''), 0xb1: ('instanceof', ''), 0xb2: ('istype', 'm'), 0xb3: ('istypelate', ''),
    0xb4: ('in', ''), 0xc0: ('increment_i', ''), 0xc1: ('decrement_i', ''), 0xc2: ('inclocal_i', 'n'),
    0xc3: ('declocal_i', 'n'), 0xc4: ('negate_i', ''), 0xc5: ('add_i', ''), 0xc6: ('subtract_i', ''),
    0xc7: ('multiply_i', ''), 0xd0: ('getlocal_0', ''), 0xd1: ('getlocal_1', ''), 0xd2: ('getlocal_2', ''),
    0xd3: ('getlocal_3', ''), 0xd4: ('setlocal_0', ''), 0xd5: ('setlocal_1', ''), 0xd6: ('setlocal_2', ''),
    0xd7: ('setlocal_3', ''), 0xef: ('debug', 'D'), 0xf0: ('debugline', 'n'), 0xf1: ('debugfile', 's'),
    0xf2: ('bkptline', 'n'), 0xf3: ('timestamp', ''),
}

BIN = {'add': '+', 'subtract': '-', 'multiply': '*', 'divide': '/', 'modulo': '%', 'lshift': '<<', 'rshift': '>>',
       'urshift': '>>>', 'bitand': '&', 'bitor': '|', 'bitxor': '^', 'equals': '==', 'strictequals': '===',
       'lessthan': '<', 'lessequals': '<=', 'greaterthan': '>', 'greaterequals': '>=', 'instanceof': 'instanceof',
       'istypelate': 'is', 'astypelate': 'as', 'in': 'in', 'add_i': '+', 'subtract_i': '-', 'multiply_i': '*'}
CMP = {'ifeq': '==', 'ifne': '!=', 'iflt': '<', 'ifle': '<=', 'ifgt': '>', 'ifge': '>=', 'ifstricteq': '===',
       'ifstrictne': '!==', 'ifnlt': '!<', 'ifnle': '!<=', 'ifngt': '!>', 'ifnge': '!>='}


def decode(abc, code):
    r = R(code); out = []
    while r.p < len(code):
        at = r.p; op = r.u8(); name, spec = OPS.get(op, (f'op_{op:02x}', ''))
        args = []
        for c in spec:
            if c == 'j':
                off = r.s24(); args.append(r.p + off)
            elif c == 'L':
                d = at + r.s24(); cc = r.u30(); args.append([d] + [at + r.s24() for _ in range(cc + 1)])
            elif c == 'b':
                v = r.u8(); args.append(v - 256 if v > 127 else v)
            elif c == 'D':
                r.u8(); r.u30(); r.u8(); r.u30()
            else:
                args.append(r.u30())
        out.append((at, name, args))
    return out


class Decompiler:
    def __init__(self, abc, mi, owner_locals=None):
        self.abc = abc; self.m = abc.methods[mi]

    def local(self, i):
        if i == 0:
            return 'this'
        m = self.m
        if i <= m['pc']:
            if m['pnames'] and m['pnames'][i - 1]:
                return self.abc.strings[m['pnames'][i - 1]]
            return f'arg{i}'
        if i == m['pc'] + 1 and m['flags'] & 0x05:
            return 'arguments' if m['flags'] & 0x01 else 'rest'
        return f'_loc{i}'

    def mname(self, i, st):
        """Resolve a multiname, popping runtime parts from stack."""
        m = self.abc.mn[i]
        if m and m[0] in ('ML', 'RTQL'):
            idx = st.pop() if st else '?'
            if m[0] == 'RTQL' and st:
                st.pop()
            return None, idx
        if m and m[0] == 'RTQ' and st:
            st.pop()
        return self.abc.qn(i), None

    def run(self, ind='    '):
        abc = self.abc; body = self.m['body']
        if not body:
            return [ind + '/* native/abstract */']
        try:
            ins = decode(abc, body['code'])
        except Exception as e:
            return [ind + f'/* decode error {e} */']
        targets = set()
        for at, n, a in ins:
            if n == 'lookupswitch':
                targets.update(a[0])
            elif OPS.get(next((k for k, v in OPS.items() if v[0] == n), 0), ('', ''))[1] == 'j':
                targets.add(a[0])
        for e in body['exc']:
            targets.add(e[2])
        lines = []; st = []
        switch_at = {}
        for i, (at, n, a) in enumerate(ins):
            if n == 'lookupswitch':
                switch_at[at] = a[0]
        # a jump that lands on kill/label then lookupswitch also counts
        for i, (at, n, a) in enumerate(ins):
            j = i
            while j < len(ins) and ins[j][1] in ('kill', 'label', 'nop'):
                j += 1
            if j < len(ins) and ins[j][1] == 'lookupswitch' and j != i:
                switch_at[at] = ins[j][2][0]
        dead = False
        def resolve_switch(tbl):
            v = st[-1] if st else None
            if v is not None and v.lstrip('-').isdigit():
                st.pop(); k = int(v)
                return tbl[k + 1] if 0 <= k < len(tbl) - 1 else tbl[0]
            return None
        def emit(s):
            lines.append(ind + s)
        def P():
            return st.pop() if st else '?'
        def args(n):
            a = [P() for _ in range(n)]; return ', '.join(reversed(a))
        def prop(obj, name, idx):
            if name is None:
                return f'{obj}[{idx}]'
            return name if obj in ('this', '[scope]') or obj is None else f'{obj}.{name}'
        for at, n, a in ins:
            if at in targets:
                if dead:
                    st = []
                elif st:
                    emit(f'/* stack: {" ; ".join(st)} */')
                emit(f'L{at}:')
                dead = False
            elif dead and n not in ('label',):
                continue
            if at in switch_at and n != 'lookupswitch' and n in ('kill', 'label', 'nop'):
                pass
            if n in ('debugline', 'debugfile', 'debug', 'label', 'nop', 'pushscope', 'popscope', 'pushwith', 'kill', 'timestamp', 'bkptline'):
                if n in ('pushscope', 'pushwith'):
                    P()
                continue
            if n.startswith('getlocal'):
                st.append(self.local(a[0] if a else int(n[-1])))
            elif n.startswith('setlocal'):
                emit(f'{self.local(a[0] if a else int(n[-1]))} = {P()};')
            elif n in ('pushbyte', 'pushshort'):
                st.append(str(a[0]))
            elif n == 'pushint':
                st.append(str(abc.ints[a[0]]))
            elif n == 'pushuint':
                st.append(str(abc.uints[a[0]]))
            elif n == 'pushdouble':
                st.append(repr(abc.doubles[a[0]]))
            elif n == 'pushstring':
                st.append(S(abc.strings[a[0]]))
            elif n in ('pushtrue', 'pushfalse', 'pushnull', 'pushundefined', 'pushnan'):
                st.append({'pushtrue': 'true', 'pushfalse': 'false', 'pushnull': 'null', 'pushundefined': 'undefined', 'pushnan': 'NaN'}[n])
            elif n == 'pushnamespace':
                st.append(f'ns({abc.nsname(a[0])})')
            elif n in ('findpropstrict', 'findproperty', 'getglobalscope', 'getscopeobject', 'getouterscope'):
                if n.startswith('find'):
                    self.mname(a[0], st)
                st.append('[scope]')
            elif n in ('getlex', 'finddef'):
                st.append(abc.qn(a[0]))
            elif n in ('getproperty', 'getsuper', 'getdescendants'):
                name, idx = self.mname(a[0], st); obj = P()
                if n == 'getsuper':
                    obj = 'super'
                st.append(prop(obj, name, idx) if n != 'getdescendants' else f'{obj}..{name}')
            elif n in ('setproperty', 'initproperty', 'setsuper'):
                v = P(); name, idx = self.mname(a[0], st); obj = P()
                if n == 'setsuper':
                    obj = 'super'
                emit(f'{prop(obj, name, idx)} = {v};')
            elif n == 'deleteproperty':
                name, idx = self.mname(a[0], st); obj = P(); st.append(f'delete {prop(obj, name, idx)}')
            elif n in ('callproperty', 'callproplex', 'callpropvoid', 'callsuper', 'callsupervoid', 'constructprop'):
                ar = args(a[1]); name, idx = self.mname(a[0], st); obj = P()
                if 'super' in n:
                    obj = 'super'
                e = f'{prop(obj, name, idx)}({ar})'
                if n == 'constructprop':
                    e = 'new ' + e
                if n.endswith('void'):
                    emit(e + ';')
                else:
                    st.append(e)
            elif n == 'callmethod':
                ar = args(a[1]); obj = P(); st.append(f'{obj}.method#{a[0]}({ar})')
            elif n == 'callstatic':
                ar = args(a[1]); obj = P(); st.append(f'{abc.strings[abc.methods[a[0]]["name"]]}({ar})')
            elif n == 'call':
                ar = args(a[0]); recv = P(); fn = P(); st.append(f'{fn}({ar})')
            elif n == 'construct':
                ar = args(a[0]); st.append(f'new {P()}({ar})')
            elif n == 'constructsuper':
                ar = args(a[0]); P(); emit(f'super({ar});')
            elif n == 'newobject':
                kv = [P() for _ in range(2 * a[0])][::-1]
                st.append('{' + ', '.join(f'{kv[i]}: {kv[i + 1]}' for i in range(0, len(kv), 2)) + '}')
            elif n == 'newarray':
                st.append('[' + args(a[0]) + ']')
            elif n == 'newfunction':
                st.append(f'function#{a[0]}')
            elif n == 'newclass':
                P(); st.append(f'class#{a[0]}')
            elif n == 'newactivation':
                st.append('[activation]')
            elif n == 'newcatch':
                st.append('[catch]')
            elif n in ('getslot', 'getglobalslot'):
                obj = P() if n == 'getslot' else 'global'; st.append(f'{obj}.slot{a[0]}')
            elif n in ('setslot', 'setglobalslot'):
                v = P(); obj = P() if n == 'setslot' else 'global'; emit(f'{obj}.slot{a[0]} = {v};')
            elif n in ('coerce', 'astype'):
                v = P(); st.append(v if n == 'coerce' else f'({v} as {abc.qn(a[0])})')
            elif n == 'istype':
                v = P(); st.append(f'({v} is {abc.qn(a[0])})')
            elif n.startswith('convert_') or n.startswith('coerce_') or n == 'checkfilter':
                v = P(); conv = {'convert_i': 'int', 'coerce_i': 'int', 'convert_u': 'uint', 'coerce_u': 'uint',
                                 'convert_d': 'Number', 'coerce_d': 'Number', 'convert_s': 'String'}.get(n)
                st.append(f'{conv}({v})' if conv and not v.lstrip('-').replace('.', '').isdigit() else v)
            elif n in BIN:
                b = P(); x = P(); st.append(f'({x} {BIN[n]} {b})')
            elif n in ('not',):
                st.append(f'!{P()}')
            elif n in ('negate', 'negate_i'):
                st.append(f'-{P()}')
            elif n == 'bitnot':
                st.append(f'~{P()}')
            elif n == 'typeof':
                st.append(f'typeof {P()}')
            elif n in ('increment', 'increment_i'):
                st.append(f'({P()} + 1)')
            elif n in ('decrement', 'decrement_i'):
                st.append(f'({P()} - 1)')
            elif n in ('inclocal', 'inclocal_i'):
                emit(f'{self.local(a[0])}++;')
            elif n in ('declocal', 'declocal_i'):
                emit(f'{self.local(a[0])}--;')
            elif n == 'dup':
                v = P(); st += [v, v]
            elif n == 'swap':
                b = P(); x = P(); st += [b, x]
            elif n == 'pop':
                v = P()
                if '(' in v:
                    emit(v + ';')
            elif n == 'returnvoid':
                emit('return;'); dead = True
            elif n == 'returnvalue':
                emit(f'return {P()};'); dead = True
            elif n == 'throw':
                emit(f'throw {P()};'); dead = True
            elif n == 'jump':
                t = a[0]
                if t in switch_at:
                    c = resolve_switch(switch_at[t])
                    if c is not None:
                        t = c
                emit(f'goto L{t};'); targets.add(t); dead = True
            elif n == 'iftrue':
                emit(f'if ({P()}) goto L{a[0]};')
            elif n == 'iffalse':
                emit(f'if (!{P()}) goto L{a[0]};')
            elif n in CMP:
                b = P(); x = P(); emit(f'if ({x} {CMP[n]} {b}) goto L{a[0]};')
            elif n == 'lookupswitch':
                c = resolve_switch(a[0])
                if c is not None:
                    emit(f'goto L{c};'); dead = True; continue
                emit(f'switch ({P()}) default:L{a[0][0]} ' + ' '.join(f'case {i}:L{t}' for i, t in enumerate(a[0][1:])))
            elif n in ('hasnext', 'hasnext2'):
                if n == 'hasnext':
                    i2 = P(); o = P(); st.append(f'hasnext({o}, {i2})')
                else:
                    st.append(f'hasnext2({self.local(a[0])}, {self.local(a[1])})')
            elif n in ('nextname', 'nextvalue'):
                i2 = P(); o = P(); st.append(f'{n}({o}, {i2})')
            elif n == 'applytype':
                ar = args(a[0]); st.append(f'{P()}.<{ar}>')
            else:
                emit(f'/* {n} {a} */')
        return lines


def trait_line(abc, t, static=False):
    name = abc.qn(t['name']); pre = 'static ' if static else ''
    k = t['kind']
    if k in (0, 6):
        v = abc.const(t['vi'], t['vk'])
        return f"{pre}{'const' if k == 6 else 'var'} {name}:{abc.qn(t['type'])}{' = ' + v if v else ''};"
    return None


def sig(abc, mi, name, prefix=''):
    m = abc.methods[mi]
    ps = []
    for i in range(m['pc']):
        pn = abc.strings[m['pnames'][i]] if m['pnames'] and m['pnames'][i] else f'arg{i + 1}'
        p = f'{pn}:{abc.qn(m["pt"][i])}'
        oi = i - (m['pc'] - len(m['opts']))
        if oi >= 0:
            p += ' = ' + (abc.const(*m['opts'][oi]) or '?')
        ps.append(p)
    if m['flags'] & 0x04:
        ps.append('...rest')
    return f'{prefix}function {name}({", ".join(ps)}):{abc.qn(m["ret"])}'


def dump_method(abc, mi, header, out):
    out.append('    ' + header)
    out.append('    {')
    out.extend('    ' + l for l in Decompiler(abc, mi).run())
    out.append('    }')
    out.append('')


def dump(abc, outdir):
    os.makedirs(outdir, exist_ok=True)
    done = set()
    for ci, inst in enumerate(abc.instances):
        full = abc.qn(inst['name'], full=True)
        out = [f'// class {full} extends {abc.qn(inst["sup"], full=True)}'
               + (f' implements {", ".join(abc.qn(x) for x in inst["intf"])}' if inst['intf'] else '')]
        out.append('{')
        for static, traits in ((True, abc.classes[ci]['traits']), (False, inst['traits'])):
            for t in traits:
                l = trait_line(abc, t, static)
                if l:
                    out.append('    ' + l)
        out.append('')
        dump_method(abc, abc.classes[ci]['cinit'], 'static init()', out)
        dump_method(abc, inst['iinit'], sig(abc, inst['iinit'], abc.qn(inst['name'])), out)
        for static, traits in ((True, abc.classes[ci]['traits']), (False, inst['traits'])):
            for t in traits:
                if t['kind'] in (1, 2, 3):
                    kw = {1: '', 2: 'get ', 3: 'set '}[t['kind']]
                    dump_method(abc, t['method'], sig(abc, t['method'], kw + abc.qn(t['name']), 'static ' if static else ''), out)
        out.append('}')
        path = os.path.join(outdir, *full.split('.')) + '.as'
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, 'w') as f:
            f.write('\n'.join(out) + '\n')
    out = []
    for si, s in enumerate(abc.scripts):
        if any(t['kind'] in (0, 6) for t in s['traits']):
            dump_method(abc, s['init'], f'script{si} init()', out)
        for t in s['traits']:
            l = trait_line(abc, t)
            if l:
                out.append(l)
            if t['kind'] in (1, 5):
                dump_method(abc, t['method'], sig(abc, t['method'], abc.qn(t['name'], True)), out)
    with open(os.path.join(outdir, 'scripts.as'), 'w') as f:
        f.write('\n'.join(out) + '\n')
    with open(os.path.join(outdir, 'strings.txt'), 'w') as f:
        f.write('\n'.join(repr(s) for s in abc.strings))


if __name__ == '__main__':
    dump(Abc(open(sys.argv[1], 'rb').read()), sys.argv[2])
