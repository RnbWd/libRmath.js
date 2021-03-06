/*  AUTHOR
 *  Jacob Bogers, jkfbogers@gmail.com
 *  March 14, 2017
 *
 *  ORIGINAL AUTHOR
 *  Mathlib : A C Library of Special Functions
 *  Copyright (C) 1998-2015 The R Core Team
 *  based on AS243 (C) 1989 Royal Statistical Society
 *
 *  This program is free software; you can redistribute it and/or modify
 *  it under the terms of the GNU General Public License as published by
 *  the Free Software Foundation; either version 2 of the License, or
 *  (at your option) any later version.
 *
 *  This program is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU General Public License for more details.
 *
 *  You should have received a copy of the GNU General Public License
 *  along with this program; if not, a copy is available at
 *  https://www.R-project.org/Licenses/
 */

/*  Algorithm AS 243  Lenth,R.V. (1989). Appl. Statist., Vol.38, 185-189.
 *  ----------------
 *  Cumulative probability at t of the non-central t-distribution
 *  with df degrees of freedom (may be fractional) and non-centrality
 *  parameter delta.
 *
 *  NOTE
 *
 *    Requires the following auxiliary routines:
 *
 *	lgammafn(x)	- log gamma function
 *	pbeta(x, a, b)	- incomplete beta function
 *	pnorm(x)	- normal distribution function
 *
 *  CONSTANTS
 *
 *    M_SQRT_2dPI  = 1/ {gamma(1.5) * sqrt(2)} = sqrt(2 / pi)
 *    M_LN_SQRT_PI = ln(sqrt(pi)) = ln(pi)/2
 */

/*----------- DEBUGGING -------------
 *
 *	make CFLAGS='-DDEBUG_pnt -g'

 * -- Feb.3, 1999; M.Maechler:
    - For 't > ncp > 20' (or so)	the result is completely WRONG!  <== no longer true
    - but for ncp > 100
 */

import * as debug from 'debug';
import { pbeta } from '../beta/pbeta';
import {
  //DBL_MIN_EXP,
  M_LN_SQRT_PI,
  M_SQRT_2dPI,
  ME,
  ML_ERR_return_NAN,
  ML_ERROR,
  R_DT_0,
  R_DT_1,
  R_DT_val
} from '../common/_general';
import { lgammafn } from '../gamma/lgamma_fn';
import { pnorm5 as pnorm } from '../normal/pnorm';
import { map } from '../r-func';
import { pt } from './pt';

const { isFinite: R_FINITE, EPSILON: DBL_EPSILON } = Number;
const { sqrt, exp, pow, log, expm1, abs: fabs, min: fmin2 } = Math;
const printer_pnt = debug('pnt');
const DBL_MIN_EXP = -1021;
const M_LN2 = 0.693147180559945309417;

export function pnt<T>(
  tt: T,
  df: number,
  ncp: number,
  lowerTail: boolean = true,
  logP: boolean = false
): T {
  return map(tt)(t =>
    _pnt(t, df, ncp, lowerTail, logP /*, normal*/)
  ) as any;
}

function _pnt(
  _t: number,
  df: number,
  ncp: number,
  lower_tail: boolean = true,
  log_p: boolean = false
): number {
  //double
  let errbd: number;
  let rxb: number;
  let x: number;

  // long double
  let geven: number;
  let godd: number;
  let p: number;
  let q: number;

  let s: number;

  let tnc: number = 0;
  let xeven: number;
  let xodd: number;
  // int

  /* note - itrmax and errmax may be changed to suit one's needs. */

  const itrmax = 1000;
  const errmax = 1e-12;

  if (df <= 0.0) {
    return ML_ERR_return_NAN(printer_pnt);
  }

  if (ncp === 0.0) {
    return pt(_t, df, lower_tail, log_p);
  }

  if (!R_FINITE(_t)) {
    return _t < 0 ? R_DT_0(lower_tail, log_p) : R_DT_1(lower_tail, log_p);
  }

  const negdel = _t < 0;
  const tt = fabs(_t);
  const del = _t >= 0 ? ncp : -ncp;

  /* 
      We deal quickly with left tail if extreme,
        since pt(q, df, ncp) <= pt(0, df, ncp) = \Phi(-ncp) 
    */
  if (_t < 0 && ncp > 40 && (!log_p || !lower_tail)) {
    printer_pnt('if x <=0 and solution for edge ncp > 40');
    return R_DT_0(lower_tail, log_p);
  }

  if (df > 4e5 || del * del > 2 * M_LN2 * -DBL_MIN_EXP) {
    printer_pnt(
      'Abramowitz & Stegun 26.7.10 ncp:%d, del:%d, ncp2:%d, del2:%d, D:%d',
      ncp,
      del,
      ncp * ncp,
      del * del,
      2 * M_LN2 * -DBL_MIN_EXP
    );

    // in JS its del >= 38.604  then 0.5*exp(-0.5(del*del)) === 0
    // use Number.MIN_VALUE = 5e-324 to calculate
    /*
       -- 2nd part: if del > 37.62, then p=0 below
          FIXME: test should depend on `df', `tt' AND `del' ! 
    */
    /* 
      Approx. from	 Abramowitz & Stegun 26.7.10 (p.949) 
    */
    const _s = 1 / (4 * df);

    return pnorm(
      tt * (1 - _s),
      del,
      sqrt(1 + tt * tt * 2 * _s),
      lower_tail !== negdel,
      log_p
    );
  }

  /* initialize twin series */
  /* Guenther, J. (1978). Statist. Computn. Simuln. vol.6, 199. */

  x = _t * _t; // always positive?
  rxb = df / (x + df); /* := (1 - x) {x below} -- but more accurately */
  x = x / (x + df); /* in [0,1) */

  printer_pnt(
    'pnt(t=%d, df=%d, ncp=%d, rxb=%d) ==> x= %d',
    _t,
    df,
    ncp,
    rxb,
    x
  );

  // x will be always >= 0
  // because df >0
  // edge case is x==0, then we skip this
  if (x > 0) {
    printer_pnt('x > 0 branch');
    /* <==>  t != 0 */
    const lambda = del * del;
    p = 0.5 * exp(-0.5 * lambda);

    printer_pnt('p=%d', p);

    if (p === 0) {
      /* underflow! */
      printer_pnt('p=%d, underflow protection', p);
      /*========== really use an other algorithm for this case !!! */
      ML_ERROR(ME.ME_UNDERFLOW, 'pnt', printer_pnt);
      ML_ERROR(ME.ME_RANGE, 'pnt', printer_pnt); /* |ncp| too large */
      return R_DT_0(lower_tail, log_p);
    }

    printer_pnt(
      'it  1e5*(godd,   geven)|          p           q           s' +
        /* 1.3 1..4..7.9 1..4..7.9|1..4..7.901 1..4..7.901 1..4..7.901 */
        '        pnt(*)     errbd'
    );
    /* 1..4..7..0..34 1..4..7.9*/

    q = M_SQRT_2dPI * p * del;
    s = 0.5 - p;
    /* s = 0.5 - p = 0.5*(1 - exp(-.5 L)) =  -0.5*expm1(-.5 L)) */
    if (s < 1e-7) s = -0.5 * expm1(-0.5 * lambda);
    let a = 0.5;
    let b = 0.5 * df;
    /* rxb = (1 - x) ^ b   [ ~= 1 - b*x for tiny x --> see 'xeven' below]
         *       where '(1 - x)' =: rxb {accurately!} above */
    rxb = pow(rxb, b);
    const albeta = M_LN_SQRT_PI + lgammafn(b) - lgammafn(0.5 + b);
    xodd = pbeta(x, a, b, /*lower*/ true, /*log_p*/ false);
    printer_pnt('return from pbeta:%d', xodd);
    godd = 2 * rxb * exp(a * log(x) - albeta);
    tnc = b * x;
    xeven = tnc < DBL_EPSILON ? tnc : 1 - rxb;
    geven = tnc * rxb;
    tnc = p * xodd + q * xeven;

    let gotoFinis = false;

    /* repeat until convergence or iteration limit */
    for (let it = 1; it <= itrmax; it++) {
      a += 1;
      xodd -= godd;
      xeven -= geven;
      godd *= x * (a + b - 1) / a;
      geven *= x * (a + b - 0.5) / (a + 0.5);
      p *= lambda / (2 * it);
      q *= lambda / (2 * it + 1);
      tnc += p * xodd + q * xeven;
      s -= p;
      /* R 2.4.0 added test for rounding error here. */

      if (s < -1e-10) {
        /* happens e.g. for (t,df,ncp)=(40,10,38.5), after 799 it.*/
        ML_ERROR(ME.ME_PRECISION, 'pnt', printer_pnt);
        printer_pnt('goto:true, s = %d < 0 !!! ---> non-convergence!!', s);
        gotoFinis = true;
        break;
      }
      if (s <= 0) {
        printer_pnt('goto:true, s:%d < 0 && it:%d>1', s, it);
        gotoFinis = true;
        break;
      }
      errbd = 2 * s * (xodd - godd);

      printer_pnt(
        '%d %d %d|%d %d %d %d %d',
        it,
        1e5 * godd,
        1e5 * geven,
        p,
        q,
        s,
        tnc,
        errbd
      );

      if (fabs(errbd) < errmax) {
        printer_pnt('goto:true, errbd:%d < errmax:%d', errbd, errmax);
        gotoFinis = true; /*convergence*/
        break;
      }
      gotoFinis = false;
    } //for (it = 1; it <= itrmax; it++)
    /* non-convergence:*/
    if (!gotoFinis) {
      ML_ERROR(ME.ME_NOCONV, 'pnt', printer_pnt);
    }
  }
  //finis: goto label
  tnc += pnorm(-del, 0, 1, /*lower*/ true, /*log_p*/ false);

  lower_tail = lower_tail !== negdel; /* xor */
  /*
    negdel = (t < 0)
    lt nd  | nlt
    T  T   |  F
    T  F   |  T
    F  T   |  T
    T  T      F

  */
  if (tnc > 1 - 1e-10 && lower_tail) {
    ML_ERROR(ME.ME_PRECISION, 'pnt{final}', printer_pnt);
  }
  const rc = R_DT_val(lower_tail, log_p, fmin2(tnc, 1) /* Precaution */);
  printer_pnt(
    'rc:%d, tnc:%d, log_p:%s, lower_tail:%s',
    rc,
    tnc,
    log_p,
    lower_tail
  );

  return rc;
}
