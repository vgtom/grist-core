// tslint:disable:max-classes-per-file

import {CellValue} from 'app/common/DocActions';
import * as gristTypes from 'app/common/gristTypes';
import * as gutil from 'app/common/gutil';
import {buildNumberFormat, NumberFormatOptions} from 'app/common/NumberFormat';
import {decodeObject, GristDateTime} from 'app/plugin/objtypes';
import isPlainObject = require('lodash/isPlainObject');
import * as moment from 'moment-timezone';
import {DocumentSettings} from 'app/common/DocumentSettings';

export {PENDING_DATA_PLACEHOLDER} from 'app/plugin/objtypes';

export interface FormatOptions {
  [option: string]: any;
}

/**
 * Formats a value of any type generically (with no type-specific options).
 */
export function formatUnknown(value: CellValue): string {
  return formatDecoded(decodeObject(value));
}

/**
 * Formats a decoded Grist value for displaying it. For top-level values, formats them the way we
 * like to see them in a cell or in, say, CSV export. For lists and objects, nested values are
 * formatted slighly differently, with quoted strings and ISO format for dates.
 */
export function formatDecoded(value: unknown, isTopLevel: boolean = true): string {
  if (typeof value === 'object' && value) {
    if (Array.isArray(value)) {
      return '[' + value.map(v => formatDecoded(v, false)).join(', ') + ']';
    } else if (isPlainObject(value)) {
      const obj: any = value;
      const items = Object.keys(obj).map(k => `${JSON.stringify(k)}: ${formatDecoded(obj[k], false)}`);
      return '{' + items.join(', ') + '}';
    } else if (isTopLevel && value instanceof GristDateTime) {
      return moment(value).tz(value.timezone).format("YYYY-MM-DD HH:mm:ssZ");
    }
    return String(value);
  }
  if (isTopLevel) {
    return (value == null ? "" : String(value));
  }
  return JSON.stringify(value);
}

export type IsRightTypeFunc = (value: CellValue) => boolean;

export class BaseFormatter {
  public readonly isRightType: IsRightTypeFunc;

  constructor(public type: string, public widgetOpts: object, public docSettings: DocumentSettings) {
    this.isRightType = gristTypes.isRightType(gristTypes.extractTypeFromColType(type)) ||
      gristTypes.isRightType('Any')!;
  }

  /**
   * Formats a value that matches the type of this formatter. This should be overridden by derived
   * classes to handle values in formatter-specific ways.
   */
  public format(value: any): string {
    return String(value);
  }

  /**
   * Formats using this.format() if a value is of the right type for this formatter, or using
   * AnyFormatter otherwise. This method the recommended API. There is no need to override it.
   */
  public formatAny(value: any): string {
    return this.isRightType(value) ? this.format(value) : formatUnknown(value);
  }
}

class AnyFormatter extends BaseFormatter {
  public format(value: any): string {
    return formatUnknown(value);
  }
}

export class NumericFormatter extends BaseFormatter {
  private _numFormat: Intl.NumberFormat;
  private _formatter: (val: number) => string;

  constructor(type: string, options: NumberFormatOptions, docSettings: DocumentSettings) {
    super(type, options, docSettings);
    this._numFormat = buildNumberFormat(options, docSettings);
    this._formatter = (options.numSign === 'parens') ? this._formatParens : this._formatPlain;
  }

  public format(value: any): string {
    return value === null ? '' : this._formatter(value);
  }

  public _formatPlain(value: number): string {
    return this._numFormat.format(value);
  }

  public _formatParens(value: number): string {
    // Surround positive numbers with spaces to align them visually to parenthesized numbers.
    return (value >= 0) ?
      ` ${this._numFormat.format(value)} ` :
      `(${this._numFormat.format(-value)})`;
  }
}

class IntFormatter extends NumericFormatter {
  constructor(type: string, opts: FormatOptions, docSettings: DocumentSettings) {
    super(type, {decimals: 0, ...opts}, docSettings);
  }
}

export interface DateFormatOptions {
  dateFormat?: string;
}

class DateFormatter extends BaseFormatter {
  private _dateTimeFormat: string;
  private _timezone: string;

  constructor(type: string, widgetOpts: DateFormatOptions, docSettings: DocumentSettings, timezone: string = 'UTC') {
    super(type, widgetOpts, docSettings);
    this._dateTimeFormat = widgetOpts.dateFormat || 'YYYY-MM-DD';
    this._timezone = timezone;
  }

  public format(value: any): string {
    if (value === null) { return ''; }
    const time = moment.tz(value * 1000, this._timezone);
    return time.format(this._dateTimeFormat);
  }
}

export interface DateTimeFormatOptions extends DateFormatOptions {
  timeFormat?: string;
}

class DateTimeFormatter extends DateFormatter {
  constructor(type: string, widgetOpts: DateTimeFormatOptions, docSettings: DocumentSettings) {
    const timezone = gutil.removePrefix(type, "DateTime:") || '';
    const timeFormat = widgetOpts.timeFormat === undefined ? 'h:mma' : widgetOpts.timeFormat;
    const dateFormat = (widgetOpts.dateFormat || 'YYYY-MM-DD') + " " + timeFormat;
    super(type, {dateFormat}, docSettings, timezone);
  }
}

const formatters: {[name: string]: typeof BaseFormatter} = {
  Numeric: NumericFormatter,
  Int: IntFormatter,
  Bool: BaseFormatter,
  Date: DateFormatter,
  DateTime: DateTimeFormatter,
  // We don't list anything that maps to AnyFormatter, since that's the default.
};

/**
 * Takes column type, widget options and document settings, and returns a constructor
 * with a format function that can properly convert a value passed to it into the
 * right format for that column.
 */
export function createFormatter(type: string, widgetOpts: FormatOptions, docSettings: DocumentSettings): BaseFormatter {
  const ctor = formatters[gristTypes.extractTypeFromColType(type)] || AnyFormatter;
  return new ctor(type, widgetOpts, docSettings);
}
