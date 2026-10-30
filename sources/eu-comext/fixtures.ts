// Real answers of the Eurostat Comext API (DS-045409), copied on 2026-10-30 from GitHub Actions probes cmx-a1, cmx-a2 and cmx-a3. Nothing edited.
// WHEAT_DE_JUN: reporter DE, partner WORLD, product 1001, imports, 2026-06.  CHEESE_FR_EXPORTS: reporter FR, partner WORLD, product 0406, exports, 2026-05..2026-08 (Aug has no data yet).
// EMPTY_CELL: reporter DE, partner EU27_2020_INTRA (not a real partner code here), product 10019099: an empty cell has an empty partner dimension and value {}.
export const WHEAT_DE_JUN = {
 "version": "2.0",
 "class": "dataset",
 "label": "EU trade since 1988 by HS2-4-6 and CN8",
 "source": "ESTAT",
 "updated": "2026-10-16T11:00:00+0200",
 "value": {
  "1": 3342854.64,
  "0": 71425923
 },
 "id": [
  "freq",
  "reporter",
  "partner",
  "product",
  "flow",
  "indicators",
  "time"
 ],
 "size": [
  1,
  1,
  1,
  1,
  1,
  2,
  1
 ],
 "dimension": {
  "freq": {
   "label": "Frequency",
   "category": {
    "index": {
     "M": 0
    },
    "label": {
     "M": "Monthly"
    }
   }
  },
  "reporter": {
   "label": "REPORTER",
   "category": {
    "index": {
     "DE": 0
    },
    "label": {
     "DE": "Germany (incl. German Democratic Republic 'DD' from 1991)"
    }
   }
  },
  "partner": {
   "label": "PARTNER",
   "category": {
    "index": {
     "WORLD": 0
    },
    "label": {
     "WORLD": "All countries of the world"
    }
   }
  },
  "product": {
   "label": "PRODUCT",
   "category": {
    "index": {
     "1001": 0
    },
    "label": {
     "1001": "Wheat and meslin"
    }
   }
  },
  "flow": {
   "label": "FLOW",
   "category": {
    "index": {
     "1": 0
    },
    "label": {
     "1": "IMPORT"
    }
   }
  },
  "indicators": {
   "label": "INDICATORS",
   "category": {
    "index": {
     "VALUE_IN_EUROS": 0,
     "QUANTITY_IN_100KG": 1
    },
    "label": {
     "VALUE_IN_EUROS": "VALUE_IN_EUROS",
     "QUANTITY_IN_100KG": "QUANTITY_IN_100KG"
    }
   }
  },
  "time": {
   "label": "TIME_PERIOD",
   "category": {
    "index": {
     "2026-06": 0
    },
    "label": {
     "2026-06": "2026-06"
    }
   }
  }
 },
 "extension": {
  "lang": "EN",
  "id": "DS-045409",
  "agencyId": "ESTAT",
  "version": "1.0",
  "datastructure": {
   "id": "DS-045409",
   "agencyId": "ESTAT",
   "version": "6.6"
  },
  "annotation": [
   {
    "type": "DISSEMINATION_OBJECT_TYPE",
    "title": "DATASET"
   },
   {
    "type": "DISSEMINATION_TIMESTAMP_DATA",
    "date": "2026-10-16T11:00:00+0200"
   },
   {
    "type": "DISSEMINATION_TIMESTAMP_GLOBAL",
    "date": "2026-10-16T11:00:00+0200"
   },
   {
    "type": "DISSEMINATION_TIMESTAMP_PLANNED",
    "date": "2026-10-16T11:00:00+0200"
   },
   {
    "type": "ESMS_HTML",
    "title": "Explanatory texts (metadata)",
    "href": "https://ec.europa.eu/eurostat/cache/metadata/en/ext_go_detail_sims.htm"
   },
   {
    "type": "UPDATE_DATA",
    "date": "2026-10-16T11:00:00+0200"
   },
   {
    "type": "UPDATE_STRUCTURE",
    "date": "2026-10-16T11:00:00+0200"
   }
  ],
  "positions-with-no-data": {
   "freq": [],
   "reporter": [],
   "partner": [],
   "product": [],
   "flow": [],
   "indicators": [],
   "time": []
  }
 }
} as const;
export const CHEESE_FR_EXPORTS = {
 "version": "2.0",
 "class": "dataset",
 "label": "EU trade since 1988 by HS2-4-6 and CN8",
 "source": "ESTAT",
 "updated": "2026-10-16T11:00:00+0200",
 "value": {
  "4": 547633.91,
  "5": 573291.43,
  "6": 585777.63,
  "0": 295205013,
  "1": 317466314,
  "2": 315514092
 },
 "id": [
  "freq",
  "reporter",
  "partner",
  "product",
  "flow",
  "indicators",
  "time"
 ],
 "size": [
  1,
  1,
  1,
  1,
  1,
  2,
  4
 ],
 "dimension": {
  "freq": {
   "label": "Frequency",
   "category": {
    "index": {
     "M": 0
    },
    "label": {
     "M": "Monthly"
    }
   }
  },
  "reporter": {
   "label": "REPORTER",
   "category": {
    "index": {
     "FR": 0
    },
    "label": {
     "FR": "France (incl. Saint Barth\u00e9lemy 'BL' -> 2012; incl. French Guiana 'GF', Guadeloupe 'GP', Martinique 'MQ', R\u00e9union 'RE' from 1997; incl. Mayotte 'YT' from 2014)"
    }
   }
  },
  "partner": {
   "label": "PARTNER",
   "category": {
    "index": {
     "WORLD": 0
    },
    "label": {
     "WORLD": "All countries of the world"
    }
   }
  },
  "product": {
   "label": "PRODUCT",
   "category": {
    "index": {
     "0406": 0
    },
    "label": {
     "0406": "Cheese and curd"
    }
   }
  },
  "flow": {
   "label": "FLOW",
   "category": {
    "index": {
     "2": 0
    },
    "label": {
     "2": "EXPORT"
    }
   }
  },
  "indicators": {
   "label": "INDICATORS",
   "category": {
    "index": {
     "VALUE_IN_EUROS": 0,
     "QUANTITY_IN_100KG": 1
    },
    "label": {
     "VALUE_IN_EUROS": "VALUE_IN_EUROS",
     "QUANTITY_IN_100KG": "QUANTITY_IN_100KG"
    }
   }
  },
  "time": {
   "label": "TIME_PERIOD",
   "category": {
    "index": {
     "2026-05": 0,
     "2026-06": 1,
     "2026-07": 2,
     "2026-08": 3
    },
    "label": {
     "2026-05": "2026-05",
     "2026-06": "2026-06",
     "2026-07": "2026-07",
     "2026-08": "2026-08"
    }
   }
  }
 },
 "extension": {
  "lang": "EN",
  "id": "DS-045409",
  "agencyId": "ESTAT",
  "version": "1.0",
  "datastructure": {
   "id": "DS-045409",
   "agencyId": "ESTAT",
   "version": "6.6"
  },
  "annotation": [
   {
    "type": "DISSEMINATION_OBJECT_TYPE",
    "title": "DATASET"
   },
   {
    "type": "DISSEMINATION_TIMESTAMP_DATA",
    "date": "2026-10-16T11:00:00+0200"
   },
   {
    "type": "DISSEMINATION_TIMESTAMP_GLOBAL",
    "date": "2026-10-16T11:00:00+0200"
   },
   {
    "type": "DISSEMINATION_TIMESTAMP_PLANNED",
    "date": "2026-10-16T11:00:00+0200"
   },
   {
    "type": "ESMS_HTML",
    "title": "Explanatory texts (metadata)",
    "href": "https://ec.europa.eu/eurostat/cache/metadata/en/ext_go_detail_sims.htm"
   },
   {
    "type": "UPDATE_DATA",
    "date": "2026-10-16T11:00:00+0200"
   },
   {
    "type": "UPDATE_STRUCTURE",
    "date": "2026-10-16T11:00:00+0200"
   }
  ],
  "positions-with-no-data": {
   "freq": [],
   "reporter": [],
   "partner": [],
   "product": [],
   "flow": [],
   "indicators": [],
   "time": [
    3
   ]
  }
 }
} as const;
export const EMPTY_CELL = {
 "version": "2.0",
 "class": "dataset",
 "label": "EU trade since 1988 by HS2-4-6 and CN8",
 "source": "ESTAT",
 "updated": "2026-10-16T11:00:00+0200",
 "value": {},
 "id": [
  "freq",
  "reporter",
  "partner",
  "product",
  "flow",
  "indicators",
  "time"
 ],
 "size": [
  1,
  1,
  0,
  1,
  1,
  2,
  1
 ],
 "dimension": {
  "freq": {
   "label": "Frequency",
   "category": {
    "index": {
     "M": 0
    },
    "label": {
     "M": "Monthly"
    }
   }
  },
  "reporter": {
   "label": "REPORTER",
   "category": {
    "index": {
     "DE": 0
    },
    "label": {
     "DE": "Germany (incl. German Democratic Republic 'DD' from 1991)"
    }
   }
  },
  "partner": {
   "label": "PARTNER",
   "category": {
    "index": {},
    "label": {}
   }
  },
  "product": {
   "label": "PRODUCT",
   "category": {
    "index": {
     "10019099": 0
    },
    "label": {
     "10019099": "Spelt, common wheat and meslin (excl. seed)"
    }
   }
  },
  "flow": {
   "label": "FLOW",
   "category": {
    "index": {
     "1": 0
    },
    "label": {
     "1": "IMPORT"
    }
   }
  },
  "indicators": {
   "label": "INDICATORS",
   "category": {
    "index": {
     "VALUE_IN_EUROS": 0,
     "QUANTITY_IN_100KG": 1
    },
    "label": {
     "VALUE_IN_EUROS": "VALUE_IN_EUROS",
     "QUANTITY_IN_100KG": "QUANTITY_IN_100KG"
    }
   }
  },
  "time": {
   "label": "TIME_PERIOD",
   "category": {
    "index": {
     "2026-06": 0
    },
    "label": {
     "2026-06": "2026-06"
    }
   }
  }
 },
 "extension": {
  "lang": "EN",
  "id": "DS-045409",
  "agencyId": "ESTAT",
  "version": "1.0",
  "datastructure": {
   "id": "DS-045409",
   "agencyId": "ESTAT",
   "version": "6.6"
  },
  "annotation": [
   {
    "type": "DISSEMINATION_OBJECT_TYPE",
    "title": "DATASET"
   },
   {
    "type": "DISSEMINATION_TIMESTAMP_DATA",
    "date": "2026-10-16T11:00:00+0200"
   },
   {
    "type": "DISSEMINATION_TIMESTAMP_GLOBAL",
    "date": "2026-10-16T11:00:00+0200"
   },
   {
    "type": "DISSEMINATION_TIMESTAMP_PLANNED",
    "date": "2026-10-16T11:00:00+0200"
   },
   {
    "type": "ESMS_HTML",
    "title": "Explanatory texts (metadata)",
    "href": "https://ec.europa.eu/eurostat/cache/metadata/en/ext_go_detail_sims.htm"
   },
   {
    "type": "UPDATE_DATA",
    "date": "2026-10-16T11:00:00+0200"
   },
   {
    "type": "UPDATE_STRUCTURE",
    "date": "2026-10-16T11:00:00+0200"
   }
  ],
  "positions-with-no-data": {
   "freq": [
    0
   ],
   "reporter": [
    0
   ],
   "partner": [],
   "product": [
    0
   ],
   "flow": [
    0
   ],
   "indicators": [
    0,
    1
   ],
   "time": [
    0
   ]
  }
 }
} as const;
