export interface SeedSku {
  skuCode: string;
  size: string;
  color: string;
  price: string;
  stockQuantity: number;
}

export interface SeedProduct {
  name: string;
  description: string;
  skus: SeedSku[];
}

export interface SeedCategory {
  name: string;
  slug: string;
  products: SeedProduct[];
}

const sizes = (
  prefix: string,
  color: string,
  price: string,
  stock: readonly [string, number][],
): SeedSku[] =>
  stock.map(([size, stockQuantity]) => ({
    skuCode: `${prefix}-${size}-${color.toUpperCase()}`,
    size,
    color,
    price,
    stockQuantity,
  }));

export const CATALOG: SeedCategory[] = [
  {
    name: 'T-Shirts',
    slug: 't-shirts',
    products: [
      {
        name: 'Classic Crew Tee',
        description: 'Mid-weight combed cotton crew neck with a taped collar.',
        skus: [
          ...sizes('CREW', 'black', '24.50', [
            ['S', 18],
            ['M', 24],
            ['L', 12],
          ]),
          ...sizes('CREW', 'white', '24.50', [
            ['M', 20],
            ['L', 9],
          ]),
        ],
      },
      {
        name: 'Heavyweight Pocket Tee',
        description: 'Boxy 240 gsm body with a reinforced chest pocket.',
        skus: [
          ...sizes('POCKET', 'sand', '29.00', [
            ['M', 14],
            ['L', 7],
          ]),
          ...sizes('POCKET', 'navy', '29.00', [['L', 3]]),
        ],
      },
    ],
  },
  {
    name: 'Long Sleeve',
    slug: 'long-sleeve',
    products: [
      {
        name: 'Ribbed Long Sleeve',
        description: 'Ribbed cuffs and a straight hem, cut for layering.',
        skus: [
          ...sizes('RIBLS', 'charcoal', '32.00', [
            ['M', 11],
            ['L', 16],
          ]),
          ...sizes('RIBLS', 'olive', '32.00', [['M', 5]]),
        ],
      },
      {
        name: 'Henley Long Sleeve',
        description: 'Three-button placket in a soft slub jersey.',
        skus: [
          ...sizes('HENLEY', 'oatmeal', '38.00', [
            ['S', 6],
            ['M', 13],
          ]),
        ],
      },
    ],
  },
  {
    name: 'Polo Shirts',
    slug: 'polo-shirts',
    products: [
      {
        name: 'Pique Polo',
        description: 'Classic pique knit with a two-button placket.',
        skus: [
          ...sizes('PIQUE', 'white', '42.00', [
            ['M', 15],
            ['L', 10],
          ]),
          ...sizes('PIQUE', 'forest', '42.00', [['L', 2]]),
        ],
      },
    ],
  },
  {
    name: 'Hoodies',
    slug: 'hoodies',
    products: [
      {
        name: 'Pullover Hoodie',
        description:
          'Brushed-back fleece with a lined hood and kangaroo pocket.',
        skus: [
          ...sizes('HOOD', 'heather-grey', '68.00', [
            ['M', 8],
            ['L', 12],
            ['XL', 4],
          ]),
        ],
      },
      {
        name: 'Zip Hoodie',
        description: 'Full-length metal zip with split-pouch pockets.',
        skus: [
          ...sizes('ZIPHOOD', 'black', '74.00', [
            ['M', 6],
            ['L', 3],
          ]),
        ],
      },
    ],
  },
  {
    name: 'Sweatshirts',
    slug: 'sweatshirts',
    products: [
      {
        name: 'Crewneck Sweatshirt',
        description: 'Dropped shoulders and ribbed side panels.',
        skus: [
          ...sizes('SWEAT', 'cream', '58.00', [
            ['M', 17],
            ['L', 9],
          ]),
          ...sizes('SWEAT', 'rust', '58.00', [['M', 3]]),
        ],
      },
    ],
  },
  {
    name: 'Tank Tops',
    slug: 'tank-tops',
    products: [
      {
        name: 'Ribbed Tank',
        description: 'Close-fitting rib with a scooped neckline.',
        skus: [
          ...sizes('TANK', 'white', '19.00', [
            ['S', 22],
            ['M', 16],
          ]),
          ...sizes('TANK', 'black', '19.00', [['M', 2]]),
        ],
      },
    ],
  },
  {
    name: 'Caps',
    slug: 'caps',
    products: [
      {
        name: 'Six-Panel Cap',
        description: 'Structured cotton twill with a curved brim.',
        skus: [
          ...sizes('CAP6', 'navy', '26.00', [['OS', 30]]),
          ...sizes('CAP6', 'black', '26.00', [['OS', 3]]),
        ],
      },
      {
        name: 'Corduroy Cap',
        description: 'Soft five-panel corduroy with a metal buckle strap.',
        skus: [...sizes('CORDCAP', 'tan', '31.00', [['OS', 12]])],
      },
    ],
  },
  {
    name: 'Accessories',
    slug: 'accessories',
    products: [
      {
        name: 'Canvas Tote',
        description: '16 oz canvas tote with reinforced webbing handles.',
        skus: [...sizes('TOTE', 'natural', '22.00', [['OS', 25]])],
      },
      {
        name: 'Ribbed Socks',
        description: 'Combed cotton crew socks in a three-pack.',
        skus: [
          ...sizes('SOCK', 'white', '14.00', [
            ['M', 40],
            ['L', 28],
          ]),
        ],
      },
    ],
  },
  {
    name: 'Limited Editions',
    slug: 'limited-editions',
    products: [
      {
        name: 'Anniversary Print Tee',
        description: 'Numbered screen print, one run only.',
        skus: [
          ...sizes('ANNIV', 'black', '54.00', [
            ['M', 3],
            ['L', 2],
          ]),
        ],
      },
    ],
  },
  {
    name: 'Outlet',
    slug: 'outlet',
    products: [
      {
        name: 'Last Season Crew Tee',
        description: 'Previous colourway, reduced while stock lasts.',
        skus: [
          ...sizes('OUTCREW', 'mustard', '12.00', [
            ['S', 4],
            ['M', 1],
          ]),
        ],
      },
    ],
  },
];
