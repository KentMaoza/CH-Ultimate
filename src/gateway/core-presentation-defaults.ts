import type {
  InvoiceTemplate,
  LabelTemplate,
} from '../domain/types';

// These are neutral renderer configuration, never business records.
export const CORE_LABEL_TEMPLATE_DEFAULT: LabelTemplate = {
  medium: 'thermal',
  widthMm: 50,
  heightMm: 30,
  columns: 1,
  marginMm: 2,
  gapMm: 2,
  fontSize: 10,
  alignment: 'center',
  fields: ['qr', 'name', 'sku', 'price'],
};

export const CORE_INVOICE_TEMPLATE_DEFAULT: InvoiceTemplate = {
  widthMm: 210,
  heightMm: 148,
  fontSize: 12,
  logoUrl: '',
  bankAccount: 'BCA 1234567890',
  address: 'Alamat toko belum diatur',
  phone: 'No. Telp belum diatur',
  elements: [
    { id: 'logo', visible: true },
    { id: 'address', visible: true },
    { id: 'phone', visible: true },
    { id: 'bank', visible: true },
  ],
};
