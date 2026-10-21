// A real AusTender OCDS page: GET https://api.tenders.gov.au/ocds/findByDates/contractPublished/2026-10-19T00:00:00Z/2026-10-20T00:00:00Z
// (probe 21 Oct 2026). 100 releases came back; these are some of them. Supplier names and contact points are removed on purpose.
export const AU_PAGE: any = {
 "uri": "https://api.tenders.gov.au/ocds/findByDates/contractPublished/2026-10-19T00:00:00Z/2026-10-20T00:00:00Z",
 "publisher": {
  "name": "Department of Finance"
 },
 "publishedDate": "2026-10-19T23:57:44Z",
 "license": "https://creativecommons.org/licenses/by/3.0/au/",
 "version": "1.1",
 "extensions": [
  "http://cdn.tenders.gov.au/ocds/schema/extension.json"
 ],
 "links": {
  "self": "https://api.tenders.gov.au/ocds/findByDates/contractPublished/2026-10-19T00:00:00Z/2026-10-20T00:00:00Z",
  "next": "https://api.tenders.gov.au/ocds/findByDates/contractPublished/2026-10-19T00:00:00Z/2026-10-20T00:00:00Z?cursor=Vec1K_EoQW9ONC8vK0ZxYUVES1VOT05ESTRNekl3TkNsRFRqUXlPRE15TURRPWQ&prevcursor=initial&lastcursor=initial"
 },
 "releases": [
  {
   "ocid": "prod-44ee1541d045430fbe547c93f27aef35",
   "id": "prod-44ee1541d045430fbe547c93f27aef35-acc1269aa90f31db86c90bfe83007064",
   "date": "2026-10-19T21:10:20Z",
   "initiationType": "tender",
   "language": "EN",
   "parties": [
    {
     "id": "86d6c508bd820c8d6c7f10155533099d",
     "name": "(supplier name removed)",
     "roles": [
      "supplier"
     ]
    },
    {
     "id": "d317e9fed6017e055dddad0722bf3ba0",
     "name": "IP Australia",
     "roles": [
      "procuringEntity"
     ],
     "additionalIdentifiers": [
      {
       "id": "38113072755",
       "scheme": "AU-ABN"
      }
     ],
     "address": {}
    }
   ],
   "awards": [
    {
     "id": "CN4283336-630b06daa2934524849dc052fad8bd02",
     "suppliers": [
      {
       "id": "86d6c508bd820c8d6c7f10155533099d",
       "name": "(supplier name removed)"
      }
     ],
     "status": "active",
     "date": "2026-10-19T21:10:20Z"
    }
   ],
   "contracts": [
    {
     "id": "CN4283336",
     "awardID": "CN4283336-630b06daa2934524849dc052fad8bd02",
     "dateSigned": "2026-10-19T21:10:20Z",
     "description": "Provision for a Technical Specialist",
     "title": "0046007764",
     "items": [
      {
       "id": "80111600-630b06daa2934524849dc052fad8bd02",
       "classification": {
        "scheme": "UNSPSC",
        "id": "80111600"
       }
      }
     ],
     "period": {
      "startDate": "2026-10-15T13:00:00Z",
      "endDate": "2027-10-14T13:00:00Z"
     },
     "value": {
      "currency": "AUD",
      "amount": "378576.00"
     },
     "status": "active"
    }
   ],
   "tag": [
    "contract"
   ],
   "tender": {
    "id": "prod-44ee1541d045430fbe547c93f27aef35",
    "procurementMethod": "open",
    "procurementMethodDetails": "Open tender"
   }
  },
  {
   "ocid": "prod-4fe48387312c4531acb01df903e25cbb",
   "id": "prod-4fe48387312c4531acb01df903e25cbb-3de2a93391ca3496b5577e8b1890f2d9",
   "date": "2026-10-19T21:10:20Z",
   "initiationType": "tender",
   "language": "EN",
   "parties": [
    {
     "id": "a0f72bee984644a6a91ece788f109d15",
     "name": "(supplier name removed)",
     "roles": [
      "supplier"
     ]
    },
    {
     "id": "d317e9fed6017e055dddad0722bf3ba0",
     "name": "IP Australia",
     "roles": [
      "procuringEntity"
     ],
     "additionalIdentifiers": [
      {
       "id": "38113072755",
       "scheme": "AU-ABN"
      }
     ],
     "address": {}
    }
   ],
   "awards": [
    {
     "id": "CN4283338-48a7be6cac6e41d69424ebd4dee2de62",
     "suppliers": [
      {
       "id": "a0f72bee984644a6a91ece788f109d15",
       "name": "(supplier name removed)"
      }
     ],
     "status": "active",
     "date": "2026-10-19T21:10:20Z"
    }
   ],
   "contracts": [
    {
     "id": "CN4283338",
     "awardID": "CN4283338-48a7be6cac6e41d69424ebd4dee2de62",
     "dateSigned": "2026-10-19T21:10:20Z",
     "description": "Senior Cloud Security Engineer",
     "title": "0046007762",
     "items": [
      {
       "id": "80111600-48a7be6cac6e41d69424ebd4dee2de62",
       "classification": {
        "scheme": "UNSPSC",
        "id": "80111600"
       }
      }
     ],
     "period": {
      "startDate": "2026-10-18T13:00:00Z",
      "endDate": "2027-10-17T13:00:00Z"
     },
     "value": {
      "currency": "AUD",
      "amount": "410124.00"
     },
     "status": "active"
    }
   ],
   "tag": [
    "contract"
   ],
   "tender": {
    "id": "prod-4fe48387312c4531acb01df903e25cbb",
    "procurementMethod": "open",
    "procurementMethodDetails": "Open tender"
   }
  },
  {
   "ocid": "prod-12fb81a231c44d5e8e3e6ab5eaacbad2",
   "id": "prod-12fb81a231c44d5e8e3e6ab5eaacbad2-ac7d131c243f3bbf99c47de3374ceaf1",
   "date": "2026-10-19T21:10:19Z",
   "initiationType": "tender",
   "language": "EN",
   "parties": [
    {
     "id": "f56b8704baa0c881336afd2e4be7ec01",
     "name": "(supplier name removed)",
     "roles": [
      "supplier"
     ]
    },
    {
     "id": "d317e9fed6017e055dddad0722bf3ba0",
     "name": "IP Australia",
     "roles": [
      "procuringEntity"
     ],
     "additionalIdentifiers": [
      {
       "id": "38113072755",
       "scheme": "AU-ABN"
      }
     ],
     "address": {}
    }
   ],
   "awards": [
    {
     "id": "CN4283335-015b0e86500a407688df13abd8c5eb16",
     "suppliers": [
      {
       "id": "f56b8704baa0c881336afd2e4be7ec01",
       "name": "(supplier name removed)"
      }
     ],
     "status": "active",
     "date": "2026-10-19T21:10:19Z"
    }
   ],
   "contracts": [
    {
     "id": "CN4283335",
     "awardID": "CN4283335-015b0e86500a407688df13abd8c5eb16",
     "dateSigned": "2026-10-19T21:10:19Z",
     "description": "Jabra Evolve3 85 binaural and Jabra Evolve3 65 monaural headsets",
     "title": "0046007766",
     "items": [
      {
       "id": "43210000-015b0e86500a407688df13abd8c5eb16",
       "classification": {
        "scheme": "UNSPSC",
        "id": "43210000"
       }
      }
     ],
     "period": {
      "startDate": "2026-10-14T13:00:00Z",
      "endDate": "2028-10-13T13:00:00Z"
     },
     "value": {
      "currency": "AUD",
      "amount": "57035.00"
     },
     "status": "active"
    }
   ],
   "tag": [
    "contract"
   ],
   "tender": {
    "id": "prod-12fb81a231c44d5e8e3e6ab5eaacbad2",
    "procurementMethod": "open",
    "procurementMethodDetails": "Open tender"
   }
  },
  {
   "ocid": "prod-b0ab377f82224aa0a5d66a367e2a40d5",
   "id": "prod-b0ab377f82224aa0a5d66a367e2a40d5-3207444c09f4343db6d40e4940803960",
   "date": "2026-10-19T05:50:33Z",
   "initiationType": "tender",
   "language": "EN",
   "parties": [
    {
     "id": "48b612d8926f91dc257b0c7b90935c32",
     "name": "(supplier name removed)",
     "roles": [
      "supplier"
     ]
    },
    {
     "id": "0ecb828acc717bd4921605ac33868594",
     "name": "Department of Parliamentary Services",
     "roles": [
      "procuringEntity"
     ],
     "additionalIdentifiers": [
      {
       "id": "52997141147",
       "scheme": "AU-ABN"
      }
     ],
     "address": {}
    }
   ],
   "awards": [
    {
     "id": "CN4283333-2d8cf70b0218472ba450b6a76212b2de",
     "suppliers": [
      {
       "id": "48b612d8926f91dc257b0c7b90935c32",
       "name": "(supplier name removed)"
      }
     ],
     "status": "active",
     "date": "2026-10-19T05:50:33Z"
    }
   ],
   "contracts": [
    {
     "id": "CN4283333",
     "awardID": "CN4283333-2d8cf70b0218472ba450b6a76212b2de",
     "dateSigned": "2026-10-19T05:50:33Z",
     "description": "ICT Hardware",
     "title": "6000003689",
     "items": [
      {
       "id": "43210000-2d8cf70b0218472ba450b6a76212b2de",
       "classification": {
        "scheme": "UNSPSC",
        "id": "43210000"
       }
      }
     ],
     "period": {
      "startDate": "2026-10-13T13:00:00Z",
      "endDate": "2027-06-29T14:00:00Z"
     },
     "value": {
      "currency": "AUD",
      "amount": "495581.03"
     },
     "status": "active"
    }
   ],
   "tag": [
    "contract"
   ],
   "tender": {
    "id": "prod-b0ab377f82224aa0a5d66a367e2a40d5",
    "procurementMethod": "open",
    "procurementMethodDetails": "Open tender"
   }
  },
  {
   "ocid": "prod-80b9ceb66e784950b5afe61f6bb02552",
   "id": "prod-80b9ceb66e784950b5afe61f6bb02552-ca222a3097bc3f08b13d00ecd685ca64",
   "date": "2026-10-19T03:49:34Z",
   "initiationType": "tender",
   "language": "EN",
   "parties": [
    {
     "id": "1fd8d937a89ccba12fcdbe23279704e4",
     "name": "(supplier name removed)",
     "roles": [
      "supplier"
     ]
    },
    {
     "id": "0ec9911c9e99d1b7bb1b77f4abffc583",
     "name": "Department of Defence",
     "roles": [
      "procuringEntity"
     ],
     "additionalIdentifiers": [
      {
       "id": "62950639680",
       "scheme": "AU-ABN"
      }
     ],
     "address": {}
    }
   ],
   "awards": [
    {
     "id": "CN4283289-7c6fa7b6d1e14c8587c1b19c4815889f",
     "suppliers": [
      {
       "id": "1fd8d937a89ccba12fcdbe23279704e4",
       "name": "(supplier name removed)"
      }
     ],
     "status": "active",
     "date": "2026-10-19T03:49:34Z"
    }
   ],
   "contracts": [
    {
     "id": "CN4283289",
     "awardID": "CN4283289-7c6fa7b6d1e14c8587c1b19c4815889f",
     "dateSigned": "2026-10-19T03:49:34Z",
     "description": "Safety Works",
     "title": "4600094955",
     "items": [
      {
       "id": "72100000-7c6fa7b6d1e14c8587c1b19c4815889f",
       "classification": {
        "scheme": "UNSPSC",
        "id": "72100000"
       }
      }
     ],
     "period": {
      "startDate": "2026-10-14T13:00:00Z",
      "endDate": "2028-11-29T13:00:00Z"
     },
     "value": {
      "currency": "AUD",
      "amount": "7599904.40"
     },
     "status": "active"
    }
   ],
   "tag": [
    "contract"
   ],
   "tender": {
    "id": "prod-80b9ceb66e784950b5afe61f6bb02552",
    "procurementMethod": "open",
    "procurementMethodDetails": "Open tender"
   }
  },
  {
   "ocid": "prod-6ae0162fdc724f10864654320aee1696",
   "id": "prod-6ae0162fdc724f10864654320aee1696-23409c88cf13339c9eff2d92dbd0f066",
   "date": "2026-10-19T03:49:34Z",
   "initiationType": "tender",
   "language": "EN",
   "parties": [
    {
     "id": "48fc775fb42a11d4683ac00e8d844d67",
     "name": "(supplier name removed)",
     "roles": [
      "supplier"
     ]
    },
    {
     "id": "0ec9911c9e99d1b7bb1b77f4abffc583",
     "name": "Department of Defence",
     "roles": [
      "procuringEntity"
     ],
     "additionalIdentifiers": [
      {
       "id": "62950639680",
       "scheme": "AU-ABN"
      }
     ],
     "address": {}
    }
   ],
   "awards": [
    {
     "id": "CN4283290-34f4135ae2544a42864f5e17123a855f",
     "suppliers": [
      {
       "id": "48fc775fb42a11d4683ac00e8d844d67",
       "name": "(supplier name removed)"
      }
     ],
     "status": "active",
     "date": "2026-10-19T03:49:34Z"
    }
   ],
   "contracts": [
    {
     "id": "CN4283290",
     "awardID": "CN4283290-34f4135ae2544a42864f5e17123a855f",
     "dateSigned": "2026-10-19T03:49:34Z",
     "description": "Project management",
     "title": "4600094956",
     "items": [
      {
       "id": "72100000-34f4135ae2544a42864f5e17123a855f",
       "classification": {
        "scheme": "UNSPSC",
        "id": "72100000"
       }
      }
     ],
     "period": {
      "startDate": "2026-10-14T13:00:00Z",
      "endDate": "2027-06-29T14:00:00Z"
     },
     "value": {
      "currency": "AUD",
      "amount": "272581.84"
     },
     "status": "active"
    }
   ],
   "tag": [
    "contract"
   ],
   "tender": {
    "id": "prod-6ae0162fdc724f10864654320aee1696",
    "procurementMethod": "limited",
    "procurementMethodDetails": "Limited tender",
    "limitedTenderExempt": "0",
    "limitedTenderReasonCode": "AD",
    "limitedTenderReason": "10.3.e. Additional deliveries by original supplier intended as replacement parts, extensions, or continuation for existing goods or services for compatibility."
   }
  },
  {
   "ocid": "prod-09c8e49f70154ddd8e650647b0c0ffd7",
   "id": "prod-09c8e49f70154ddd8e650647b0c0ffd7-459618436ebe350696be89d3e8f8b4c0",
   "date": "2026-10-19T02:58:28Z",
   "initiationType": "tender",
   "language": "EN",
   "parties": [
    {
     "id": "78ff24b5a849f4cda41a00b10adfb8fd",
     "name": "(supplier name removed)",
     "roles": [
      "supplier"
     ]
    },
    {
     "id": "0ec9911c9e99d1b7bb1b77f4abffc583",
     "name": "Department of Defence",
     "roles": [
      "procuringEntity"
     ],
     "additionalIdentifiers": [
      {
       "id": "62950639680",
       "scheme": "AU-ABN"
      }
     ],
     "address": {}
    }
   ],
   "awards": [
    {
     "id": "CN4283273-fd1621bcf385481ab9e0dcc44fb9402a",
     "suppliers": [
      {
       "id": "78ff24b5a849f4cda41a00b10adfb8fd",
       "name": "(supplier name removed)"
      }
     ],
     "status": "active",
     "date": "2026-10-19T02:58:28Z"
    }
   ],
   "contracts": [
    {
     "id": "CN4283273",
     "awardID": "CN4283273-fd1621bcf385481ab9e0dcc44fb9402a",
     "dateSigned": "2026-10-19T02:58:28Z",
     "description": "Catering Services",
     "title": "3000828779",
     "items": [
      {
       "id": "90101600-fd1621bcf385481ab9e0dcc44fb9402a",
       "classification": {
        "scheme": "UNSPSC",
        "id": "90101600"
       }
      }
     ],
     "period": {
      "startDate": "2026-08-16T14:00:00Z",
      "endDate": "2026-08-16T14:00:00Z"
     },
     "value": {
      "currency": "AUD",
      "amount": "26444.00"
     },
     "status": "active"
    }
   ],
   "tag": [
    "contract"
   ],
   "tender": {
    "id": "prod-09c8e49f70154ddd8e650647b0c0ffd7",
    "procurementMethod": "limited",
    "procurementMethodDetails": "Limited tender",
    "limitedTenderExempt": "1"
   }
  },
  {
   "ocid": "prod-ef8350e5f6e84a1bbe001cf3a8ab8283",
   "id": "prod-ef8350e5f6e84a1bbe001cf3a8ab8283-713bfdcb4e5e3aebb20c285358baac0d",
   "date": "2026-10-19T02:58:27Z",
   "initiationType": "tender",
   "language": "EN",
   "parties": [
    {
     "id": "4adec6fffc9e70966cfb397aebaed856",
     "name": "(supplier name removed)",
     "roles": [
      "supplier"
     ]
    },
    {
     "id": "0ec9911c9e99d1b7bb1b77f4abffc583",
     "name": "Department of Defence",
     "roles": [
      "procuringEntity"
     ],
     "additionalIdentifiers": [
      {
       "id": "62950639680",
       "scheme": "AU-ABN"
      }
     ],
     "address": {}
    }
   ],
   "awards": [
    {
     "id": "CN4283272-458f05a29126427fb7c7bab7bae03dd3",
     "suppliers": [
      {
       "id": "4adec6fffc9e70966cfb397aebaed856",
       "name": "(supplier name removed)"
      }
     ],
     "status": "active",
     "date": "2026-10-19T02:58:27Z"
    }
   ],
   "contracts": [
    {
     "id": "CN4283272",
     "awardID": "CN4283272-458f05a29126427fb7c7bab7bae03dd3",
     "dateSigned": "2026-10-19T02:58:27Z",
     "description": "Watercraft Repairs",
     "title": "3000828886",
     "items": [
      {
       "id": "25111700-458f05a29126427fb7c7bab7bae03dd3",
       "classification": {
        "scheme": "UNSPSC",
        "id": "25111700"
       }
      }
     ],
     "period": {
      "startDate": "2026-09-16T14:00:00Z",
      "endDate": "2027-03-14T13:00:00Z"
     },
     "value": {
      "currency": "AUD",
      "amount": "17045.60"
     },
     "status": "active"
    }
   ],
   "tag": [
    "contract"
   ],
   "tender": {
    "id": "prod-ef8350e5f6e84a1bbe001cf3a8ab8283",
    "procurementMethod": "limited",
    "procurementMethodDetails": "Limited tender",
    "limitedTenderExempt": "1"
   }
  },
  {
   "ocid": "prod-3ecdfe8f62234a4eaaec91fea02b8e18",
   "id": "prod-3ecdfe8f62234a4eaaec91fea02b8e18-8117af4a59983cd5a72085cf6d4a6b46",
   "date": "2026-10-19T02:58:15Z",
   "initiationType": "tender",
   "language": "EN",
   "parties": [
    {
     "id": "fa3311c0c3dd8b8d326a0d3a8eec8eda",
     "name": "(supplier name removed)",
     "roles": [
      "supplier"
     ]
    },
    {
     "id": "0ec9911c9e99d1b7bb1b77f4abffc583",
     "name": "Department of Defence",
     "roles": [
      "procuringEntity"
     ],
     "additionalIdentifiers": [
      {
       "id": "62950639680",
       "scheme": "AU-ABN"
      }
     ],
     "address": {}
    }
   ],
   "awards": [
    {
     "id": "CN4283260-73b172b29f654b8eb80cdd03c8a172f3",
     "suppliers": [
      {
       "id": "fa3311c0c3dd8b8d326a0d3a8eec8eda",
       "name": "(supplier name removed)"
      }
     ],
     "status": "active",
     "date": "2026-10-19T02:58:15Z"
    }
   ],
   "contracts": [
    {
     "id": "CN4283260",
     "awardID": "CN4283260-73b172b29f654b8eb80cdd03c8a172f3",
     "dateSigned": "2026-10-19T02:58:15Z",
     "description": "ICT Equipment",
     "title": "3000858754",
     "items": [
      {
       "id": "43210000-73b172b29f654b8eb80cdd03c8a172f3",
       "classification": {
        "scheme": "UNSPSC",
        "id": "43210000"
       }
      }
     ],
     "period": {
      "startDate": "2026-10-22T13:00:00Z",
      "endDate": "2031-10-22T13:00:00Z"
     },
     "value": {
      "currency": "AUD",
      "amount": "34168.20"
     },
     "status": "active"
    }
   ],
   "tag": [
    "contract"
   ],
   "tender": {
    "id": "prod-3ecdfe8f62234a4eaaec91fea02b8e18",
    "procurementMethod": "open",
    "procurementMethodDetails": "Open tender"
   }
  },
  {
   "ocid": "prod-df5f335b40d048e084b6405941b0353f",
   "id": "prod-df5f335b40d048e084b6405941b0353f-c76579e629ee3509bf187156d0d0fa7c",
   "date": "2026-10-19T02:58:13Z",
   "initiationType": "tender",
   "language": "EN",
   "parties": [
    {
     "id": "abb94e12ab5bb33459db6a0b1dbfb5b0",
     "name": "(supplier name removed)",
     "roles": [
      "supplier"
     ]
    },
    {
     "id": "0ec9911c9e99d1b7bb1b77f4abffc583",
     "name": "Department of Defence",
     "roles": [
      "procuringEntity"
     ],
     "additionalIdentifiers": [
      {
       "id": "62950639680",
       "scheme": "AU-ABN"
      }
     ],
     "address": {}
    }
   ],
   "awards": [
    {
     "id": "CN4283257-e352627dda034c4dbbd7c2feef3766a6",
     "suppliers": [
      {
       "id": "abb94e12ab5bb33459db6a0b1dbfb5b0",
       "name": "(supplier name removed)"
      }
     ],
     "status": "active",
     "date": "2026-10-19T02:58:13Z"
    }
   ],
   "contracts": [
    {
     "id": "CN4283257",
     "awardID": "CN4283257-e352627dda034c4dbbd7c2feef3766a6",
     "dateSigned": "2026-10-19T02:58:13Z",
     "description": "ICT Equipment",
     "title": "3000864685",
     "items": [
      {
       "id": "43210000-e352627dda034c4dbbd7c2feef3766a6",
       "classification": {
        "scheme": "UNSPSC",
        "id": "43210000"
       }
      }
     ],
     "period": {
      "startDate": "2026-10-08T13:00:00Z",
      "endDate": "2026-11-19T13:00:00Z"
     },
     "value": {
      "currency": "AUD",
      "amount": "18986.00"
     },
     "status": "active"
    }
   ],
   "tag": [
    "contract"
   ],
   "tender": {
    "id": "prod-df5f335b40d048e084b6405941b0353f",
    "procurementMethod": "open",
    "procurementMethodDetails": "Open tender"
   }
  },
  {
   "ocid": "prod-89e4a522fb694e9ea86c32272a410a4e",
   "id": "prod-89e4a522fb694e9ea86c32272a410a4e-137b2221df9c326b850349c8bf20fb15",
   "date": "2026-10-19T02:58:10Z",
   "initiationType": "tender",
   "language": "EN",
   "parties": [
    {
     "id": "f2c0ba42942ed9af1e8bf361e0b53c55",
     "name": "(supplier name removed)",
     "roles": [
      "supplier"
     ]
    },
    {
     "id": "0ec9911c9e99d1b7bb1b77f4abffc583",
     "name": "Department of Defence",
     "roles": [
      "procuringEntity"
     ],
     "additionalIdentifiers": [
      {
       "id": "62950639680",
       "scheme": "AU-ABN"
      }
     ],
     "address": {}
    }
   ],
   "awards": [
    {
     "id": "CN4283254-925448658f244818866d838d80614603",
     "suppliers": [
      {
       "id": "f2c0ba42942ed9af1e8bf361e0b53c55",
       "name": "(supplier name removed)"
      }
     ],
     "status": "active",
     "date": "2026-10-19T02:58:10Z"
    }
   ],
   "contracts": [
    {
     "id": "CN4283254",
     "awardID": "CN4283254-925448658f244818866d838d80614603",
     "dateSigned": "2026-10-19T02:58:10Z",
     "description": "Audio Visual Equipment",
     "title": "3000867577",
     "items": [
      {
       "id": "43210000-925448658f244818866d838d80614603",
       "classification": {
        "scheme": "UNSPSC",
        "id": "43210000"
       }
      }
     ],
     "period": {
      "startDate": "2026-10-11T13:00:00Z",
      "endDate": "2026-11-29T13:00:00Z"
     },
     "value": {
      "currency": "AUD",
      "amount": "33397.65"
     },
     "status": "active"
    }
   ],
   "tag": [
    "contract"
   ],
   "tender": {
    "id": "prod-89e4a522fb694e9ea86c32272a410a4e",
    "procurementMethod": "open",
    "procurementMethodDetails": "Open tender"
   }
  },
  {
   "ocid": "prod-6bf3b14983d4477fbf7c4f16817ab6d4",
   "id": "prod-6bf3b14983d4477fbf7c4f16817ab6d4-f863520417bf3cfc99a97df93261b871",
   "date": "2026-10-19T02:58:09Z",
   "initiationType": "tender",
   "language": "EN",
   "parties": [
    {
     "id": "ed3e5360bf607851741467f16b754b4f",
     "name": "(supplier name removed)",
     "roles": [
      "supplier"
     ]
    },
    {
     "id": "0ec9911c9e99d1b7bb1b77f4abffc583",
     "name": "Department of Defence",
     "roles": [
      "procuringEntity"
     ],
     "additionalIdentifiers": [
      {
       "id": "62950639680",
       "scheme": "AU-ABN"
      }
     ],
     "address": {}
    }
   ],
   "awards": [
    {
     "id": "CN4283253-7489fc7883924814a227121754a39148",
     "suppliers": [
      {
       "id": "ed3e5360bf607851741467f16b754b4f",
       "name": "(supplier name removed)"
      }
     ],
     "status": "active",
     "date": "2026-10-19T02:58:09Z"
    }
   ],
   "contracts": [
    {
     "id": "CN4283253",
     "awardID": "CN4283253-7489fc7883924814a227121754a39148",
     "dateSigned": "2026-10-19T02:58:09Z",
     "description": "Audio Visual Equipment",
     "title": "3000867703",
     "items": [
      {
       "id": "43210000-7489fc7883924814a227121754a39148",
       "classification": {
        "scheme": "UNSPSC",
        "id": "43210000"
       }
      }
     ],
     "period": {
      "startDate": "2026-10-11T13:00:00Z",
      "endDate": "2026-11-29T13:00:00Z"
     },
     "value": {
      "currency": "AUD",
      "amount": "30753.18"
     },
     "status": "active"
    }
   ],
   "tag": [
    "contract"
   ],
   "tender": {
    "id": "prod-6bf3b14983d4477fbf7c4f16817ab6d4",
    "procurementMethod": "open",
    "procurementMethodDetails": "Open tender"
   }
  },
  {
   "ocid": "prod-3fc922e536b44a25b192feaf364b3bce",
   "id": "prod-3fc922e536b44a25b192feaf364b3bce-8d49d1ce310939f6961d71bf6fe42754",
   "date": "2026-10-19T23:20:42Z",
   "initiationType": "tender",
   "language": "EN",
   "parties": [
    {
     "id": "932839c6bee48b459e5ad8741ee36432",
     "name": "(supplier name removed)",
     "roles": [
      "supplier"
     ]
    },
    {
     "id": "2a40807db61848668c51cbf5fc8e915b",
     "name": "Australian Submarine Agency",
     "roles": [
      "procuringEntity"
     ],
     "additionalIdentifiers": [
      {
       "id": "",
       "scheme": "AU-ABN"
      }
     ],
     "address": {}
    }
   ],
   "awards": [
    {
     "id": "CN4283351-5d57ed6ca2454b30ab8c5e9a89d702fa",
     "suppliers": [
      {
       "id": "932839c6bee48b459e5ad8741ee36432",
       "name": "(supplier name removed)"
      }
     ],
     "status": "active",
     "date": "2026-10-19T23:20:42Z"
    }
   ],
   "contracts": [
    {
     "id": "CN4283351",
     "awardID": "CN4283351-5d57ed6ca2454b30ab8c5e9a89d702fa",
     "dateSigned": "2026-10-19T23:20:42Z",
     "description": "Storage Equipment",
     "title": "NABPurch000064320403",
     "items": [
      {
       "id": "24110000-5d57ed6ca2454b30ab8c5e9a89d702fa",
       "classification": {
        "scheme": "UNSPSC",
        "id": "24110000"
       }
      }
     ],
     "period": {
      "startDate": "2026-10-05T13:00:00Z",
      "endDate": "2026-12-30T13:00:00Z"
     },
     "value": {
      "currency": "AUD",
      "amount": "19112.24"
     },
     "status": "active"
    }
   ],
   "tag": [
    "contract"
   ],
   "tender": {
    "id": "prod-3fc922e536b44a25b192feaf364b3bce",
    "procurementMethod": "limited",
    "procurementMethodDetails": "Limited tender",
    "limitedTenderExempt": "1"
   }
  },
  {
   "ocid": "prod-527ddd2ea06a48da8f14ba40b71c8601",
   "id": "prod-527ddd2ea06a48da8f14ba40b71c8601-4395d6e29b1c3a23ba31f0dba48b9ea5",
   "date": "2026-10-19T02:58:29Z",
   "initiationType": "tender",
   "language": "EN",
   "parties": [
    {
     "id": "bbfd56b5dae1cddb243766993ce4b77f",
     "name": "(supplier name removed)",
     "roles": [
      "supplier"
     ]
    },
    {
     "id": "0ec9911c9e99d1b7bb1b77f4abffc583",
     "name": "Department of Defence",
     "roles": [
      "procuringEntity"
     ],
     "additionalIdentifiers": [
      {
       "id": "62950639680",
       "scheme": "AU-ABN"
      }
     ],
     "address": {}
    }
   ],
   "awards": [
    {
     "id": "CN4283275-a3072cd686c34a2e8d9f657eab7766d2",
     "suppliers": [
      {
       "id": "bbfd56b5dae1cddb243766993ce4b77f",
       "name": "(supplier name removed)"
      }
     ],
     "status": "active",
     "date": "2026-10-19T02:58:29Z"
    }
   ],
   "contracts": [
    {
     "id": "CN4283275",
     "awardID": "CN4283275-a3072cd686c34a2e8d9f657eab7766d2",
     "dateSigned": "2026-10-19T02:58:29Z",
     "description": "Equipment Maintenance",
     "title": "3000800692",
     "items": [
      {
       "id": "41110000-a3072cd686c34a2e8d9f657eab7766d2",
       "classification": {
        "scheme": "UNSPSC",
        "id": "41110000"
       }
      }
     ],
     "period": {
      "startDate": "2026-10-13T13:00:00Z",
      "endDate": "2026-11-15T13:00:00Z"
     },
     "value": {
      "currency": "AUD",
      "amount": "22143.00"
     },
     "status": "active"
    }
   ],
   "tag": [
    "contract"
   ],
   "tender": {
    "id": "prod-527ddd2ea06a48da8f14ba40b71c8601",
    "procurementMethod": "limited",
    "procurementMethodDetails": "Limited tender",
    "limitedTenderExempt": "1"
   }
  },
  {
   "ocid": "prod-eca383dc7e7f419cb7692a7679f07715",
   "id": "prod-eca383dc7e7f419cb7692a7679f07715-fe17c1d5efde3ff2a5ab7592cf98e3d2",
   "date": "2026-10-19T02:58:29Z",
   "initiationType": "tender",
   "language": "EN",
   "parties": [
    {
     "id": "2e2cc425d9b04cf2afcb8c1b1ea4e445",
     "name": "(supplier name removed)",
     "roles": [
      "supplier"
     ]
    },
    {
     "id": "0ec9911c9e99d1b7bb1b77f4abffc583",
     "name": "Department of Defence",
     "roles": [
      "procuringEntity"
     ],
     "additionalIdentifiers": [
      {
       "id": "62950639680",
       "scheme": "AU-ABN"
      }
     ],
     "address": {}
    }
   ],
   "awards": [
    {
     "id": "CN4283276-475b6162074a4535afb0c40679821139",
     "suppliers": [
      {
       "id": "2e2cc425d9b04cf2afcb8c1b1ea4e445",
       "name": "(supplier name removed)"
      }
     ],
     "status": "active",
     "date": "2026-10-19T02:58:29Z"
    }
   ],
   "contracts": [
    {
     "id": "CN4283276",
     "awardID": "CN4283276-475b6162074a4535afb0c40679821139",
     "dateSigned": "2026-10-19T02:58:29Z",
     "description": "Equipment Maintenance",
     "title": "3000765299",
     "items": [
      {
       "id": "26110000-475b6162074a4535afb0c40679821139",
       "classification": {
        "scheme": "UNSPSC",
        "id": "26110000"
       }
      }
     ],
     "period": {
      "startDate": "2026-10-14T13:00:00Z",
      "endDate": "2026-11-29T13:00:00Z"
     },
     "value": {
      "currency": "AUD",
      "amount": "11649.44"
     },
     "status": "active"
    }
   ],
   "tag": [
    "contract"
   ],
   "tender": {
    "id": "prod-eca383dc7e7f419cb7692a7679f07715",
    "procurementMethod": "limited",
    "procurementMethodDetails": "Limited tender",
    "limitedTenderExempt": "1"
   }
  },
  {
   "ocid": "prod-355d9c74474d408bb3d7ec631f0b0054",
   "id": "prod-355d9c74474d408bb3d7ec631f0b0054-dba31b5d47b337b282bd3383064cfc66",
   "date": "2026-10-19T02:58:22Z",
   "initiationType": "tender",
   "language": "EN",
   "parties": [
    {
     "id": "bcebeaedad642f6a404877f6c6ef53ec",
     "name": "(supplier name removed)",
     "roles": [
      "supplier"
     ]
    },
    {
     "id": "0ec9911c9e99d1b7bb1b77f4abffc583",
     "name": "Department of Defence",
     "roles": [
      "procuringEntity"
     ],
     "additionalIdentifiers": [
      {
       "id": "62950639680",
       "scheme": "AU-ABN"
      }
     ],
     "address": {}
    }
   ],
   "awards": [
    {
     "id": "CN4283267-37ae7095d29c40aeb459d893c95a0946",
     "suppliers": [
      {
       "id": "bcebeaedad642f6a404877f6c6ef53ec",
       "name": "(supplier name removed)"
      }
     ],
     "status": "active",
     "date": "2026-10-19T02:58:22Z"
    }
   ],
   "contracts": [
    {
     "id": "CN4283267",
     "awardID": "CN4283267-37ae7095d29c40aeb459d893c95a0946",
     "dateSigned": "2026-10-19T02:58:22Z",
     "description": "Electronic Equipment",
     "title": "3000843203",
     "items": [
      {
       "id": "39120000-37ae7095d29c40aeb459d893c95a0946",
       "classification": {
        "scheme": "UNSPSC",
        "id": "39120000"
       }
      }
     ],
     "period": {
      "startDate": "2026-09-23T14:00:00Z",
      "endDate": "2027-04-29T14:00:00Z"
     },
     "value": {
      "currency": "AUD",
      "amount": "147114.00"
     },
     "status": "active"
    }
   ],
   "tag": [
    "contract"
   ],
   "tender": {
    "id": "prod-355d9c74474d408bb3d7ec631f0b0054",
    "procurementMethod": "limited",
    "procurementMethodDetails": "Limited tender",
    "limitedTenderExempt": "0",
    "limitedTenderReasonCode": "CP",
    "limitedTenderReason": "10.3.a.iii. No tenderers satisfied conditions for participation."
   }
  },
  {
   "ocid": "prod-469a9e6004a14f77a60416d4c2f0d87b",
   "id": "prod-469a9e6004a14f77a60416d4c2f0d87b-1d8293cc90a73492855c8d10dab1eaab",
   "date": "2026-10-19T02:58:18Z",
   "initiationType": "tender",
   "language": "EN",
   "parties": [
    {
     "id": "bbf705c1e99d6cea5b445e0daba03a11",
     "name": "(supplier name removed)",
     "roles": [
      "supplier"
     ]
    },
    {
     "id": "0ec9911c9e99d1b7bb1b77f4abffc583",
     "name": "Department of Defence",
     "roles": [
      "procuringEntity"
     ],
     "additionalIdentifiers": [
      {
       "id": "62950639680",
       "scheme": "AU-ABN"
      }
     ],
     "address": {}
    }
   ],
   "awards": [
    {
     "id": "CN4283263-194343275de24412a2fcc3a35168a277",
     "suppliers": [
      {
       "id": "bbf705c1e99d6cea5b445e0daba03a11",
       "name": "(supplier name removed)"
      }
     ],
     "status": "active",
     "date": "2026-10-19T02:58:18Z"
    }
   ],
   "contracts": [
    {
     "id": "CN4283263",
     "awardID": "CN4283263-194343275de24412a2fcc3a35168a277",
     "dateSigned": "2026-10-19T02:58:18Z",
     "description": "Earthing Equipment",
     "title": "3000848337",
     "items": [
      {
       "id": "26100000-194343275de24412a2fcc3a35168a277",
       "classification": {
        "scheme": "UNSPSC",
        "id": "26100000"
       }
      }
     ],
     "period": {
      "startDate": "2026-09-28T14:00:00Z",
      "endDate": "2027-06-29T14:00:00Z"
     },
     "value": {
      "currency": "AUD",
      "amount": "253798.96"
     },
     "status": "active"
    }
   ],
   "tag": [
    "contract"
   ],
   "tender": {
    "id": "prod-469a9e6004a14f77a60416d4c2f0d87b",
    "procurementMethod": "open",
    "procurementMethodDetails": "Open tender"
   }
  },
  {
   "ocid": "prod-7e02f0e5091442e0867c8fb4d173f0c6",
   "id": "prod-7e02f0e5091442e0867c8fb4d173f0c6-d4a3891fc44135f281e131067050dea2",
   "date": "2026-10-19T02:58:08Z",
   "initiationType": "tender",
   "language": "EN",
   "parties": [
    {
     "id": "ed3e5360bf607851741467f16b754b4f",
     "name": "(supplier name removed)",
     "roles": [
      "supplier"
     ]
    },
    {
     "id": "0ec9911c9e99d1b7bb1b77f4abffc583",
     "name": "Department of Defence",
     "roles": [
      "procuringEntity"
     ],
     "additionalIdentifiers": [
      {
       "id": "62950639680",
       "scheme": "AU-ABN"
      }
     ],
     "address": {}
    }
   ],
   "awards": [
    {
     "id": "CN4283252-d81d17f62c954db680939f2c2c1abf80",
     "suppliers": [
      {
       "id": "ed3e5360bf607851741467f16b754b4f",
       "name": "(supplier name removed)"
      }
     ],
     "status": "active",
     "date": "2026-10-19T02:58:08Z"
    }
   ],
   "contracts": [
    {
     "id": "CN4283252",
     "awardID": "CN4283252-d81d17f62c954db680939f2c2c1abf80",
     "dateSigned": "2026-10-19T02:58:08Z",
     "description": "Audio Visual Equipment",
     "title": "3000867844",
     "items": [
      {
       "id": "43210000-d81d17f62c954db680939f2c2c1abf80",
       "classification": {
        "scheme": "UNSPSC",
        "id": "43210000"
       }
      }
     ],
     "period": {
      "startDate": "2026-10-11T13:00:00Z",
      "endDate": "2026-11-29T13:00:00Z"
     },
     "value": {
      "currency": "AUD",
      "amount": "30229.22"
     },
     "status": "active"
    }
   ],
   "tag": [
    "contract"
   ],
   "tender": {
    "id": "prod-7e02f0e5091442e0867c8fb4d173f0c6",
    "procurementMethod": "open",
    "procurementMethodDetails": "Open tender"
   }
  },
  {
   "ocid": "prod-43c644d4174b46e4b7c3fecc09db1af6",
   "id": "prod-43c644d4174b46e4b7c3fecc09db1af6-9ad4eac1cbc6387b81315c54b6d3c822",
   "date": "2026-10-19T02:58:07Z",
   "initiationType": "tender",
   "language": "EN",
   "parties": [
    {
     "id": "abb94e12ab5bb33459db6a0b1dbfb5b0",
     "name": "(supplier name removed)",
     "roles": [
      "supplier"
     ]
    },
    {
     "id": "0ec9911c9e99d1b7bb1b77f4abffc583",
     "name": "Department of Defence",
     "roles": [
      "procuringEntity"
     ],
     "additionalIdentifiers": [
      {
       "id": "62950639680",
       "scheme": "AU-ABN"
      }
     ],
     "address": {}
    }
   ],
   "awards": [
    {
     "id": "CN4283251-5753e23dbb2a4091b3d3c05821546764",
     "suppliers": [
      {
       "id": "abb94e12ab5bb33459db6a0b1dbfb5b0",
       "name": "(supplier name removed)"
      }
     ],
     "status": "active",
     "date": "2026-10-19T02:58:07Z"
    }
   ],
   "contracts": [
    {
     "id": "CN4283251",
     "awardID": "CN4283251-5753e23dbb2a4091b3d3c05821546764",
     "dateSigned": "2026-10-19T02:58:07Z",
     "description": "ICT Equipment",
     "title": "3000867967",
     "items": [
      {
       "id": "43210000-5753e23dbb2a4091b3d3c05821546764",
       "classification": {
        "scheme": "UNSPSC",
        "id": "43210000"
       }
      }
     ],
     "period": {
      "startDate": "2026-10-11T13:00:00Z",
      "endDate": "2026-11-11T13:00:00Z"
     },
     "value": {
      "currency": "AUD",
      "amount": "21835.00"
     },
     "status": "active"
    }
   ],
   "tag": [
    "contract"
   ],
   "tender": {
    "id": "prod-43c644d4174b46e4b7c3fecc09db1af6",
    "procurementMethod": "open",
    "procurementMethodDetails": "Open tender"
   }
  },
  {
   "ocid": "prod-ab2b0d3acfaf46e4a9b9bb15b9623236",
   "id": "prod-ab2b0d3acfaf46e4a9b9bb15b9623236-0f5f78e7ca3a3930bd921ed6676fece2",
   "date": "2026-10-19T02:58:06Z",
   "initiationType": "tender",
   "language": "EN",
   "parties": [
    {
     "id": "bc65b314cf947f26e744321005d1ef08",
     "name": "(supplier name removed)",
     "roles": [
      "supplier"
     ]
    },
    {
     "id": "0ec9911c9e99d1b7bb1b77f4abffc583",
     "name": "Department of Defence",
     "roles": [
      "procuringEntity"
     ],
     "additionalIdentifiers": [
      {
       "id": "62950639680",
       "scheme": "AU-ABN"
      }
     ],
     "address": {}
    }
   ],
   "awards": [
    {
     "id": "CN4283248-cc0e8ffb07c043e79c7dd13d500f3c14",
     "suppliers": [
      {
       "id": "bc65b314cf947f26e744321005d1ef08",
       "name": "(supplier name removed)"
      }
     ],
     "status": "active",
     "date": "2026-10-19T02:58:06Z"
    }
   ],
   "contracts": [
    {
     "id": "CN4283248",
     "awardID": "CN4283248-cc0e8ffb07c043e79c7dd13d500f3c14",
     "dateSigned": "2026-10-19T02:58:06Z",
     "description": "Electric Equipment",
     "title": "3000869019",
     "items": [
      {
       "id": "40100000-cc0e8ffb07c043e79c7dd13d500f3c14",
       "classification": {
        "scheme": "UNSPSC",
        "id": "40100000"
       }
      }
     ],
     "period": {
      "startDate": "2026-10-12T13:00:00Z",
      "endDate": "2027-02-11T13:00:00Z"
     },
     "value": {
      "currency": "AUD",
      "amount": "37849.67"
     },
     "status": "active"
    }
   ],
   "tag": [
    "contract"
   ],
   "tender": {
    "id": "prod-ab2b0d3acfaf46e4a9b9bb15b9623236",
    "procurementMethod": "limited",
    "procurementMethodDetails": "Limited tender",
    "limitedTenderExempt": "1"
   }
  },
  {
   "ocid": "prod-d2416eda45b2479892f8e015c6a6d299",
   "id": "prod-d2416eda45b2479892f8e015c6a6d299-7871d3dd8a13385db58e6a8db4e87abd",
   "date": "2026-10-19T02:58:05Z",
   "initiationType": "tender",
   "language": "EN",
   "parties": [
    {
     "id": "bb8b24c7ab339933670ffda440e07508",
     "name": "(supplier name removed)",
     "roles": [
      "supplier"
     ]
    },
    {
     "id": "0ec9911c9e99d1b7bb1b77f4abffc583",
     "name": "Department of Defence",
     "roles": [
      "procuringEntity"
     ],
     "additionalIdentifiers": [
      {
       "id": "62950639680",
       "scheme": "AU-ABN"
      }
     ],
     "address": {}
    }
   ],
   "awards": [
    {
     "id": "CN4283247-6af50633101947dea37d134ab984a9e9",
     "suppliers": [
      {
       "id": "bb8b24c7ab339933670ffda440e07508",
       "name": "(supplier name removed)"
      }
     ],
     "status": "active",
     "date": "2026-10-19T02:58:05Z"
    }
   ],
   "contracts": [
    {
     "id": "CN4283247",
     "awardID": "CN4283247-6af50633101947dea37d134ab984a9e9",
     "dateSigned": "2026-10-19T02:58:05Z",
     "description": "Communication Equipment",
     "title": "3000869134",
     "items": [
      {
       "id": "39120000-6af50633101947dea37d134ab984a9e9",
       "classification": {
        "scheme": "UNSPSC",
        "id": "39120000"
       }
      }
     ],
     "period": {
      "startDate": "2026-10-12T13:00:00Z",
      "endDate": "2026-12-16T13:00:00Z"
     },
     "value": {
      "currency": "AUD",
      "amount": "16720.00"
     },
     "status": "active"
    }
   ],
   "tag": [
    "contract"
   ],
   "tender": {
    "id": "prod-d2416eda45b2479892f8e015c6a6d299",
    "procurementMethod": "limited",
    "procurementMethodDetails": "Limited tender",
    "limitedTenderExempt": "1"
   }
  },
  {
   "ocid": "prod-6b3ded4335d042dfaf1498f62c366f82",
   "id": "prod-6b3ded4335d042dfaf1498f62c366f82-ec5a3c5d7abc357aaf9fa448fa24d94e",
   "date": "2026-10-19T02:58:04Z",
   "initiationType": "tender",
   "language": "EN",
   "parties": [
    {
     "id": "abb94e12ab5bb33459db6a0b1dbfb5b0",
     "name": "(supplier name removed)",
     "roles": [
      "supplier"
     ]
    },
    {
     "id": "0ec9911c9e99d1b7bb1b77f4abffc583",
     "name": "Department of Defence",
     "roles": [
      "procuringEntity"
     ],
     "additionalIdentifiers": [
      {
       "id": "62950639680",
       "scheme": "AU-ABN"
      }
     ],
     "address": {}
    }
   ],
   "awards": [
    {
     "id": "CN4283244-f6fbb1fa8fe6494bad9caa15c6f21e17",
     "suppliers": [
      {
       "id": "abb94e12ab5bb33459db6a0b1dbfb5b0",
       "name": "(supplier name removed)"
      }
     ],
     "status": "active",
     "date": "2026-10-19T02:58:04Z"
    }
   ],
   "contracts": [
    {
     "id": "CN4283244",
     "awardID": "CN4283244-f6fbb1fa8fe6494bad9caa15c6f21e17",
     "dateSigned": "2026-10-19T02:58:04Z",
     "description": "ICT Equipment",
     "title": "3000869202",
     "items": [
      {
       "id": "43210000-f6fbb1fa8fe6494bad9caa15c6f21e17",
       "classification": {
        "scheme": "UNSPSC",
        "id": "43210000"
       }
      }
     ],
     "period": {
      "startDate": "2026-10-12T13:00:00Z",
      "endDate": "2026-11-19T13:00:00Z"
     },
     "value": {
      "currency": "AUD",
      "amount": "14274.70"
     },
     "status": "active"
    }
   ],
   "tag": [
    "contract"
   ],
   "tender": {
    "id": "prod-6b3ded4335d042dfaf1498f62c366f82",
    "procurementMethod": "open",
    "procurementMethodDetails": "Open tender"
   }
  },
  {
   "ocid": "prod-3e7e6858adcc46a597d631b472e84bfe",
   "id": "prod-3e7e6858adcc46a597d631b472e84bfe-face7be9c3143a58a2c9d31bc9f5aa3a",
   "date": "2026-10-19T02:58:03Z",
   "initiationType": "tender",
   "language": "EN",
   "parties": [
    {
     "id": "12c1fb019de94d89b9b14ff0aa4d9007",
     "name": "(supplier name removed)",
     "roles": [
      "supplier"
     ]
    },
    {
     "id": "0ec9911c9e99d1b7bb1b77f4abffc583",
     "name": "Department of Defence",
     "roles": [
      "procuringEntity"
     ],
     "additionalIdentifiers": [
      {
       "id": "62950639680",
       "scheme": "AU-ABN"
      }
     ],
     "address": {}
    }
   ],
   "awards": [
    {
     "id": "CN4283242-b45e17d16c6d48b0ac235e64ee270633",
     "suppliers": [
      {
       "id": "12c1fb019de94d89b9b14ff0aa4d9007",
       "name": "(supplier name removed)"
      }
     ],
     "status": "active",
     "date": "2026-10-19T02:58:03Z"
    }
   ],
   "contracts": [
    {
     "id": "CN4283242",
     "awardID": "CN4283242-b45e17d16c6d48b0ac235e64ee270633",
     "dateSigned": "2026-10-19T02:58:03Z",
     "description": "Equipment Maintenance",
     "title": "3000869422",
     "items": [
      {
       "id": "26110000-b45e17d16c6d48b0ac235e64ee270633",
       "classification": {
        "scheme": "UNSPSC",
        "id": "26110000"
       }
      }
     ],
     "period": {
      "startDate": "2026-10-12T13:00:00Z",
      "endDate": "2027-01-16T13:00:00Z"
     },
     "value": {
      "currency": "AUD",
      "amount": "19239.00"
     },
     "status": "active"
    }
   ],
   "tag": [
    "contract"
   ],
   "tender": {
    "id": "prod-3e7e6858adcc46a597d631b472e84bfe",
    "procurementMethod": "limited",
    "procurementMethodDetails": "Limited tender",
    "limitedTenderExempt": "1"
   }
  },
  {
   "ocid": "prod-6decd61998934e25951dc9c000883fb9",
   "id": "prod-6decd61998934e25951dc9c000883fb9-c73f8d18bcd432d09a756d394ce6bdd3",
   "date": "2026-10-19T02:58:01Z",
   "initiationType": "tender",
   "language": "EN",
   "parties": [
    {
     "id": "12c1fb019de94d89b9b14ff0aa4d9007",
     "name": "(supplier name removed)",
     "roles": [
      "supplier"
     ]
    },
    {
     "id": "0ec9911c9e99d1b7bb1b77f4abffc583",
     "name": "Department of Defence",
     "roles": [
      "procuringEntity"
     ],
     "additionalIdentifiers": [
      {
       "id": "62950639680",
       "scheme": "AU-ABN"
      }
     ],
     "address": {}
    }
   ],
   "awards": [
    {
     "id": "CN4283239-0bb73f223fc14991a141c47f8c67693c",
     "suppliers": [
      {
       "id": "12c1fb019de94d89b9b14ff0aa4d9007",
       "name": "(supplier name removed)"
      }
     ],
     "status": "active",
     "date": "2026-10-19T02:58:01Z"
    }
   ],
   "contracts": [
    {
     "id": "CN4283239",
     "awardID": "CN4283239-0bb73f223fc14991a141c47f8c67693c",
     "dateSigned": "2026-10-19T02:58:01Z",
     "description": "Equipment Maintenance",
     "title": "3000869475",
     "items": [
      {
       "id": "26110000-0bb73f223fc14991a141c47f8c67693c",
       "classification": {
        "scheme": "UNSPSC",
        "id": "26110000"
       }
      }
     ],
     "period": {
      "startDate": "2026-10-12T13:00:00Z",
      "endDate": "2027-01-16T13:00:00Z"
     },
     "value": {
      "currency": "AUD",
      "amount": "19239.00"
     },
     "status": "active"
    }
   ],
   "tag": [
    "contract"
   ],
   "tender": {
    "id": "prod-6decd61998934e25951dc9c000883fb9",
    "procurementMethod": "limited",
    "procurementMethodDetails": "Limited tender",
    "limitedTenderExempt": "1"
   }
  },
  {
   "ocid": "prod-8a0eac3e2a6c4da7802d3c23efe70b3a",
   "id": "prod-8a0eac3e2a6c4da7802d3c23efe70b3a-c623428e1c5e398da2322de9efd8b886",
   "date": "2026-10-19T02:57:58Z",
   "initiationType": "tender",
   "language": "EN",
   "parties": [
    {
     "id": "f2c0ba42942ed9af1e8bf361e0b53c55",
     "name": "(supplier name removed)",
     "roles": [
      "supplier"
     ]
    },
    {
     "id": "0ec9911c9e99d1b7bb1b77f4abffc583",
     "name": "Department of Defence",
     "roles": [
      "procuringEntity"
     ],
     "additionalIdentifiers": [
      {
       "id": "62950639680",
       "scheme": "AU-ABN"
      }
     ],
     "address": {}
    }
   ],
   "awards": [
    {
     "id": "CN4283231-42dea0b723c4469db8df983f570f0a5b",
     "suppliers": [
      {
       "id": "f2c0ba42942ed9af1e8bf361e0b53c55",
       "name": "(supplier name removed)"
      }
     ],
     "status": "active",
     "date": "2026-10-19T02:57:58Z"
    }
   ],
   "contracts": [
    {
     "id": "CN4283231",
     "awardID": "CN4283231-42dea0b723c4469db8df983f570f0a5b",
     "dateSigned": "2026-10-19T02:57:58Z",
     "description": "Audio Visual Equipment",
     "title": "3000872085",
     "items": [
      {
       "id": "43210000-42dea0b723c4469db8df983f570f0a5b",
       "classification": {
        "scheme": "UNSPSC",
        "id": "43210000"
       }
      }
     ],
     "period": {
      "startDate": "2026-10-13T13:00:00Z",
      "endDate": "2026-11-29T13:00:00Z"
     },
     "value": {
      "currency": "AUD",
      "amount": "12188.99"
     },
     "status": "active"
    }
   ],
   "tag": [
    "contract"
   ],
   "tender": {
    "id": "prod-8a0eac3e2a6c4da7802d3c23efe70b3a",
    "procurementMethod": "open",
    "procurementMethodDetails": "Open tender"
   }
  },
  {
   "ocid": "prod-10efdf881eab4f52ba3e18b2bb087e7e",
   "id": "prod-10efdf881eab4f52ba3e18b2bb087e7e-c834caf566783d588989e975cfb8503f",
   "date": "2026-10-19T02:57:55Z",
   "initiationType": "tender",
   "language": "EN",
   "parties": [
    {
     "id": "4646b075cc7e428286355a21fa59fa0a",
     "name": "(supplier name removed)",
     "roles": [
      "supplier"
     ]
    },
    {
     "id": "0ec9911c9e99d1b7bb1b77f4abffc583",
     "name": "Department of Defence",
     "roles": [
      "procuringEntity"
     ],
     "additionalIdentifiers": [
      {
       "id": "62950639680",
       "scheme": "AU-ABN"
      }
     ],
     "address": {}
    }
   ],
   "awards": [
    {
     "id": "CN4283226-5a2570d048024c218c0580a596d6fcb1",
     "suppliers": [
      {
       "id": "4646b075cc7e428286355a21fa59fa0a",
       "name": "(supplier name removed)"
      }
     ],
     "status": "active",
     "date": "2026-10-19T02:57:55Z"
    }
   ],
   "contracts": [
    {
     "id": "CN4283226",
     "awardID": "CN4283226-5a2570d048024c218c0580a596d6fcb1",
     "dateSigned": "2026-10-19T02:57:55Z",
     "description": "Military Canine Equipment",
     "title": "3000872280",
     "items": [
      {
       "id": "10140000-5a2570d048024c218c0580a596d6fcb1",
       "classification": {
        "scheme": "UNSPSC",
        "id": "10140000"
       }
      }
     ],
     "period": {
      "startDate": "2026-10-14T13:00:00Z",
      "endDate": "2026-12-17T13:00:00Z"
     },
     "value": {
      "currency": "AUD",
      "amount": "10081.49"
     },
     "status": "active"
    }
   ],
   "tag": [
    "contract"
   ],
   "tender": {
    "id": "prod-10efdf881eab4f52ba3e18b2bb087e7e",
    "procurementMethod": "limited",
    "procurementMethodDetails": "Limited tender",
    "limitedTenderExempt": "1"
   }
  },
  {
   "ocid": "prod-ba9f9a73822c496c8de0f87218d1089f",
   "id": "prod-ba9f9a73822c496c8de0f87218d1089f-42b627a8acda384f91685cec2d67a1f7",
   "date": "2026-10-19T02:57:54Z",
   "initiationType": "tender",
   "language": "EN",
   "parties": [
    {
     "id": "abb94e12ab5bb33459db6a0b1dbfb5b0",
     "name": "(supplier name removed)",
     "roles": [
      "supplier"
     ]
    },
    {
     "id": "0ec9911c9e99d1b7bb1b77f4abffc583",
     "name": "Department of Defence",
     "roles": [
      "procuringEntity"
     ],
     "additionalIdentifiers": [
      {
       "id": "62950639680",
       "scheme": "AU-ABN"
      }
     ],
     "address": {}
    }
   ],
   "awards": [
    {
     "id": "CN4283223-ed7ba572bd1f4b1f820bf2ea1855e337",
     "suppliers": [
      {
       "id": "abb94e12ab5bb33459db6a0b1dbfb5b0",
       "name": "(supplier name removed)"
      }
     ],
     "status": "active",
     "date": "2026-10-19T02:57:54Z"
    }
   ],
   "contracts": [
    {
     "id": "CN4283223",
     "awardID": "CN4283223-ed7ba572bd1f4b1f820bf2ea1855e337",
     "dateSigned": "2026-10-19T02:57:54Z",
     "description": "ICT Equipment",
     "title": "3000872386",
     "items": [
      {
       "id": "43210000-ed7ba572bd1f4b1f820bf2ea1855e337",
       "classification": {
        "scheme": "UNSPSC",
        "id": "43210000"
       }
      }
     ],
     "period": {
      "startDate": "2026-10-13T13:00:00Z",
      "endDate": "2026-11-19T13:00:00Z"
     },
     "value": {
      "currency": "AUD",
      "amount": "16150.20"
     },
     "status": "active"
    }
   ],
   "tag": [
    "contract"
   ],
   "tender": {
    "id": "prod-ba9f9a73822c496c8de0f87218d1089f",
    "procurementMethod": "open",
    "procurementMethodDetails": "Open tender"
   }
  },
  {
   "ocid": "prod-8f0404d9a5a24179a436cdefe3e7ffe9",
   "id": "prod-8f0404d9a5a24179a436cdefe3e7ffe9-0503154341793eed9189d8ac40cf7172",
   "date": "2026-10-19T02:57:48Z",
   "initiationType": "tender",
   "language": "EN",
   "parties": [
    {
     "id": "abb94e12ab5bb33459db6a0b1dbfb5b0",
     "name": "(supplier name removed)",
     "roles": [
      "supplier"
     ]
    },
    {
     "id": "0ec9911c9e99d1b7bb1b77f4abffc583",
     "name": "Department of Defence",
     "roles": [
      "procuringEntity"
     ],
     "additionalIdentifiers": [
      {
       "id": "62950639680",
       "scheme": "AU-ABN"
      }
     ],
     "address": {}
    }
   ],
   "awards": [
    {
     "id": "CN4283208-68a562520ea24c748dc4741d96a6c05a",
     "suppliers": [
      {
       "id": "abb94e12ab5bb33459db6a0b1dbfb5b0",
       "name": "(supplier name removed)"
      }
     ],
     "status": "active",
     "date": "2026-10-19T02:57:48Z"
    }
   ],
   "contracts": [
    {
     "id": "CN4283208",
     "awardID": "CN4283208-68a562520ea24c748dc4741d96a6c05a",
     "dateSigned": "2026-10-19T02:57:48Z",
     "description": "ICT Equipment",
     "title": "3000874701",
     "items": [
      {
       "id": "43210000-68a562520ea24c748dc4741d96a6c05a",
       "classification": {
        "scheme": "UNSPSC",
        "id": "43210000"
       }
      }
     ],
     "period": {
      "startDate": "2026-10-06T13:00:00Z",
      "endDate": "2026-10-06T13:00:00Z"
     },
     "value": {
      "currency": "AUD",
      "amount": "14084.54"
     },
     "status": "active"
    }
   ],
   "tag": [
    "contract"
   ],
   "tender": {
    "id": "prod-8f0404d9a5a24179a436cdefe3e7ffe9",
    "procurementMethod": "open",
    "procurementMethodDetails": "Open tender"
   }
  },
  {
   "ocid": "prod-48a907652d75466383ab29a5e04a33a0",
   "id": "prod-48a907652d75466383ab29a5e04a33a0-bd50b4207e0336b3a01022e59c3239d5",
   "date": "2026-10-19T02:57:47Z",
   "initiationType": "tender",
   "language": "EN",
   "parties": [
    {
     "id": "bbca1ae1e34cafffee05a69bdf018e78",
     "name": "(supplier name removed)",
     "roles": [
      "supplier"
     ]
    },
    {
     "id": "0ec9911c9e99d1b7bb1b77f4abffc583",
     "name": "Department of Defence",
     "roles": [
      "procuringEntity"
     ],
     "additionalIdentifiers": [
      {
       "id": "62950639680",
       "scheme": "AU-ABN"
      }
     ],
     "address": {}
    }
   ],
   "awards": [
    {
     "id": "CN4283204-0b2a3b22cc5345e7a0def9107409acba",
     "suppliers": [
      {
       "id": "bbca1ae1e34cafffee05a69bdf018e78",
       "name": "(supplier name removed)"
      }
     ],
     "status": "active",
     "date": "2026-10-19T02:57:47Z"
    }
   ],
   "contracts": [
    {
     "id": "CN4283204",
     "awardID": "CN4283204-0b2a3b22cc5345e7a0def9107409acba",
     "dateSigned": "2026-10-19T02:57:47Z",
     "description": "Equipment Maintenance",
     "title": "3000874783",
     "items": [
      {
       "id": "40150000-0b2a3b22cc5345e7a0def9107409acba",
       "classification": {
        "scheme": "UNSPSC",
        "id": "40150000"
       }
      }
     ],
     "period": {
      "startDate": "2026-10-14T13:00:00Z",
      "endDate": "2027-01-28T13:00:00Z"
     },
     "value": {
      "currency": "AUD",
      "amount": "17600.00"
     },
     "status": "active"
    }
   ],
   "tag": [
    "contract"
   ],
   "tender": {
    "id": "prod-48a907652d75466383ab29a5e04a33a0",
    "procurementMethod": "limited",
    "procurementMethodDetails": "Limited tender",
    "limitedTenderExempt": "1"
   }
  }
 ]
};
