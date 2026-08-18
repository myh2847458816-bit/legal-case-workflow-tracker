(function exposeWorkflow(root, factory) {
  const value = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = value;
  else root.WorkflowData = value;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createWorkflow() {
  const template = {
    id: 'bankruptcy-workflow-v1',
    name: '破产清算（管理人）全流程',
    category: 'bankruptcy',
    categoryLabel: '破产案件',
    description: '以管理人履职为视角，覆盖接受指定、接管调查、债权审核、债权人会议、宣告破产、财产处置分配、终结注销与归档。',
    role: '破产清算案件管理人及其经办团队',
    scope: '企业破产清算通用流程；重整、和解、关联企业合并破产、金融机构、上市公司及跨境破产等特殊事项须另设专项清单。',
    builtIn: true,
    sourceVersion: '2026-08-12',
    lastReviewedAt: '2026-08-12',
    legalNote: '本模板结合通用管理人履职环节与公开规范整理，并按截至 2026 年 8 月 12 日现行有效的《企业破产法》及最高人民法院、国家税务总局、市场监管总局等公开规范核对。它是通用办案提示，不构成法律意见；具体权限、期限、表决规则、法院要求和地方办理方式必须结合本案文书及最新规定核实。审计、评估、刻章开户、线上平台、材料份数等事项仅在案件需要或有权机关要求时办理。司法会议纪要、审理工作意见属于裁判政策或工作指引，不宜单独作为全国统一法定义务的依据。2025 年提交审议的企业破产法修订草案尚未生效，本模板未将草案内容作为现行规则。',
    sources: [
      { title: '中华人民共和国企业破产法', url: 'https://www.npc.gov.cn/npc/c2/c183/c198/201905/t20190522_25968.html' },
      { title: '最高人民法院关于适用《中华人民共和国企业破产法》若干问题的规定（二）', url: 'https://gongbao.court.gov.cn/Details/a8cf0deff0d638a2fad2bc64677f6f.html' },
      { title: '最高人民法院关于适用《中华人民共和国企业破产法》若干问题的规定（三）', url: 'https://gongbao.court.gov.cn/Details/2767d0164e52411e47607e2d32c437.html' },
      { title: '全国法院破产审判工作会议纪要', url: 'https://gongbao.court.gov.cn/Details/2ee4b89e25f895a91885e746d361a0.html' },
      { title: '最高人民法院关于推进破产案件依法高效审理的意见', url: 'https://www.court.gov.cn/fabu/xiangqing/227391.html' },
      { title: '最高人民法院关于审理企业破产案件确定管理人报酬的规定', url: 'https://www.court.gov.cn/zixun/xiangqing/1169.html' },
      { title: '最高人民法院关于企业破产案件信息公开的规定（试行）', url: 'https://www.court.gov.cn/fabu/xiangqing/37442.html' },
      { title: '最高人民法院关于审理企业破产案件指定管理人的规定', url: 'https://www.court.gov.cn/zixun/xiangqing/1085.html' },
      { title: '国家税务总局、最高人民法院关于企业破产程序中若干税费征管事项的公告', url: 'https://fgk.chinatax.gov.cn/zcfgk/c100012/c5245432/content.html' },
      { title: '企业注销指引（2025年修订）', url: 'https://www.samr.gov.cn/zw/zfxxgk/fdzdgknr/djzcj/art/2025/art_1b0f53c66d4c4daf893f7220a394ac7b.html' }
    ],
    stages: [
      {
        id: 'appointment',
        name: '接受指定',
        groups: [
          {
            id: 'appointment-letter',
            title: '发函给法院',
            tasks: [
              { id: 'appointment-oa-filing', title: '按本机构制度办理立项、利益冲突检索和案源备案', detail: '属于机构内部管理事项；不适用时可在案件中标记为“不适用”。' },
              {
                id: 'appointment-prepare-letters',
                title: '按法院要求提交管理人团队、送达地址、印章账户等必要联络或备案材料',
                detail: '具体函件、盖章方式、份数及是否需要刻章开户证明，以指定决定和受理法院要求为准。'
              }
            ]
          }
        ]
      },
      {
        id: 'court-file-review',
        name: '法院阅卷',
        groups: [
          {
            id: 'collect-and-review-files',
            title: '接收裁定书、决定书、公告并阅卷',
            tasks: [
              { id: 'contact-judge-assistant', title: '联系法院确定接收文书和阅卷的渠道、权限及时间' },
              { id: 'schedule-file-review', title: '核对卷宗目录并制定阅卷、摘录和补充调取清单' },
              { id: 'scan-and-bind-files', title: '依阅卷规则复制、扫描或摘录必要材料，安全归档并控制访问权限' }
            ]
          }
        ]
      },
      {
        id: 'initial-takeover',
        name: '接管与紧急事项',
        groups: [
          {
            id: 'takeover-inventory',
            title: '实际接管并形成清册',
            tasks: [
              { id: 'takeover-identify-custodians', title: '查明实际占有财产、印章、证照、账簿、文书及电子数据的相关人员' },
              { id: 'takeover-demand-delivery', title: '通知相关人员移交并说明保管、配合和如实回答询问等法定义务' },
              { id: 'takeover-count-record', title: '现场或以其他可核验方式清点接收，制作交接清单、影像和签收记录' },
              { id: 'takeover-uncooperative-report', title: '拒不移交、资料灭失或财产存在风险时，及时向法院报告并申请采取相应措施' }
            ]
          },
          {
            id: 'takeover-pending-contracts',
            title: '在法定期限内处理未履行完毕合同',
            tasks: [
              { id: 'takeover-contract-inventory', title: '梳理受理前成立且双方均未履行完毕的合同及履行状态' },
              { id: 'takeover-contract-decide', title: '评估解除或继续履行对债务人财产和全体债权人的影响并形成书面决定' },
              { id: 'takeover-contract-notify', title: '自受理之日起二个月内通知相对方；收到催告的，自收到之日起三十日内答复', detail: '逾期未通知或未答复的，依法视为解除合同；决定继续履行而相对方要求担保的，应依法处理。' },
              { id: 'takeover-contract-followup', title: '登记解除损害赔偿债权、继续履行产生的共益债务及后续履约情况' }
            ]
          },
          {
            id: 'takeover-pending-cases',
            title: '衔接未结诉讼、仲裁与执行',
            tasks: [
              { id: 'takeover-case-register', title: '汇总债务人未结诉讼、仲裁、保全和执行案件并建立期限台账' },
              { id: 'takeover-notify-case-authorities', title: '向相关办案机关提交受理和指定管理人文书，核验中止执行、解除保全等处理状态' },
              { id: 'takeover-resume-cases', title: '完成财产接管后，依法代表债务人恢复或参加有关诉讼、仲裁及其他法律程序' }
            ]
          },
          {
            id: 'pre-meeting-business-major-actions',
            title: '一债会前营业及重大处分审批',
            conditional: true,
            conditionText: '第一次债权人会议前拟继续或停止营业，或拟实施《企业破产法》第六十九条所列重大财产行为时办理。',
            tasks: [
              { id: 'pre-meeting-assess-business', title: '评估继续或停止营业以及拟实施重大行为的必要性、风险和费用' },
              { id: 'pre-meeting-request-permission', title: '向法院提交书面方案和依据，取得许可后再实施' },
              { id: 'pre-meeting-record-actions', title: '留存法院许可、实施过程和资金财产变动记录，并在债权人会议上报告' }
            ]
          },
          {
            id: 'emergency-property-realization',
            title: '紧急变价并提存价款',
            conditional: true,
            conditionText: '发现权属不清的鲜活易腐、不易保管，或不及时变现将严重贬损的财产时办理。',
            tasks: [
              { id: 'emergency-property-assess', title: '记录财产状态、权属争议、贬损风险和紧急变价必要性' },
              { id: 'emergency-property-realize', title: '依法及时变价，确保过程、定价及交付可核验' },
              { id: 'emergency-property-deposit', title: '提存变价款并通知可能的权利人，保留其就价款行使取回权的条件' }
            ]
          }
        ]
      },
      {
        id: 'before-first-creditors-meeting',
        name: '一债会前',
        groups: [
          {
            id: 'seal-and-account',
            title: '按案件要求刻章、开户',
            conditional: true,
            conditionText: '受理法院、开户机构或案件办理确有需要时办理，具体地点、材料及流程依有权机关要求。',
            tasks: [
              { id: 'make-seals', title: '凭指定管理人决定书等材料依法刻制、备案并启用管理人印章' },
              { id: 'open-bank-account', title: '按金融机构要求开设、管理破产案件专用账户' }
            ]
          },
          {
            id: 'company-registry-files',
            title: '调取企业登记档案',
            tasks: [
              { id: 'find-registration-authority', title: '查询破产企业登记机关' },
              {
                id: 'print-company-files',
                title: '通过有权机关提供的线上或线下渠道调取企业登记档案',
                detail: '所需材料、调取范围和办理方式以登记机关的现行要求为准。'
              }
            ]
          },
          {
            id: 'post-bankruptcy-notice',
            title: '配合法院完成受理公告与已知债权人通知',
            tasks: [
              { id: 'publish-notice-online', title: '核验法院依法发出的受理通知和公告，按法院委托或案件分工在破产信息网协助发布并留存记录', detail: '受理通知和公告的法定主体为人民法院。' },
              { id: 'notice-known-creditors-check', title: '向法院提供已知债权人名册、联系方式及送达线索，核验通知情况' }
            ]
          },
          {
            id: 'on-site-notice',
            title: '经营场所张贴公告',
            conditional: true,
            conditionText: '法院明确要求，或结合企业经营状态、现场人员和债权人知悉需要确有必要时办理。',
            tasks: [
              { id: 'post-notice-on-site', title: '在适当经营场所张贴法院公告并以照片、视频或见证记录留痕', detail: '张贴位置和方式应兼顾有效告知、财产安全及个人信息保护。' }
            ]
          },
          {
            id: 'request-handover',
            title: '督促实际占有人移交财产和资料',
            tasks: [
              { id: 'prepare-handover-letter', title: '根据实际占有情况制作财产、印章、账簿、文书和电子数据移交通知' },
              { id: 'send-handover-letter', title: '向法定代表人及实际占有、管理相关财产资料的人员送达移交通知' }
            ]
          },
          {
            id: 'handover-public-notice',
            title: '发布移交通知或公告',
            conditional: true,
            conditionText: '无法联系实际占有人、送达未果，或法院要求以公告方式督促移交时办理。',
            tasks: [
              { id: 'publish-handover-notice', title: '依法发布移交通知或公告并留存发布、查询及反馈记录' }
            ]
          },
          {
            id: 'creditor-list',
            title: '查找债权人并制作债权人汇总表',
            tasks: [
              { id: 'collect-creditors-from-files', title: '从法院卷宗摘录申请执行人信息' },
              { id: 'search-litigation-creditors', title: '检索与破产企业存在诉讼纠纷的对方当事人' },
              { id: 'verify-creditor-contacts', title: '查询并核实债权人联系方式' },
              { id: 'prepare-creditor-summary', title: '制作债权人汇总表' }
            ]
          },
          {
            id: 'notify-creditors',
            title: '配合法院通知已知债权人申报债权',
            tasks: [
              { id: 'prepare-claim-notice', title: '根据法院公告、案件分工或法院委托准备债权申报通知材料' },
              { id: 'prepare-claim-template', title: '准备统一债权申报模板及下载二维码' },
              { id: 'send-claim-notices', title: '按法院安排向已知债权人送达申报通知，并对疑似债权人发送申报提示', detail: '人民法院是法定通知主体；管理人应留存法院授权、案件分工及送达记录。' }
            ]
          },
          {
            id: 'debtor-property-check',
            title: '核查债务人财产',
            tasks: [
              { id: 'check-tax', title: '通过主管税务机关现行渠道核查欠税及由税务机关征收的社会保险费情况' },
              { id: 'check-social-insurance', title: '向社会保险基金管理中心核查拖欠社保费情况' },
              { id: 'check-housing-fund', title: '向住房公积金管理中心核查公积金缴存情况' },
              { id: 'check-customs', title: '向海关核查欠缴关税情况' },
              { id: 'check-vehicles', title: '通过有权机关提供的渠道查询车辆登记、查封及抵押情况', detail: '查询方式和材料以车辆登记机关的现行要求为准。' },
              { id: 'check-real-estate', title: '通过有权机关提供的渠道查询不动产登记、查封及抵押情况', detail: '查询方式和材料以不动产登记机关的现行要求为准。' }
            ]
          },
          {
            id: 'intangible-property-check',
            title: '核查债务人无形财产及证券',
            tasks: [
              { id: 'check-trademarks', title: '在国家商标局网站查询商标专用权' },
              { id: 'check-copyrights', title: '通过有权机关现行渠道及债务人资料核查著作权' },
              { id: 'check-securities', title: '向依法提供查询的证券登记结算、证券经营及金融机构核查证券账户、证券资产和相关权利负担' }
            ]
          },
          {
            id: 'prepare-meeting-materials',
            title: '制作一债会资料',
            tasks: [
              { id: 'draft-first-meeting-pack', title: '根据接管、债权审查和财产调查情况制作第一次债权人会议资料' },
              { id: 'prepare-manager-report', title: '制作管理人阶段性履职报告和债务人财产状况报告' },
              { id: 'prepare-meeting-agenda', title: '形成会议议程、债权核查事项、需审议方案和表决规则' },
              { id: 'prepare-remuneration-report', title: '准备法院确定的管理人报酬方案内容并列入会议报告' },
              { id: 'prepare-management-plan', title: '拟订债务人财产管理方案，供债权人会议审议' }
            ]
          },
          {
            id: 'claim-review',
            title: '作出债权审核意见',
            tasks: [
              { id: 'review-filed-claims', title: '针对已申报债权逐笔作出审核意见' },
              { id: 'notify-review-result', title: '将审核意见通知债权人及债务人', detail: '可邮寄，也可在第一次债权人会议现场转交并签收。' }
            ]
          },
          {
            id: 'claim-table',
            title: '制作债权表',
            tasks: [
              { id: 'prepare-claim-table', title: '制作包含申报数额、初审数额的债权表' },
              { id: 'append-claim-table', title: '将债权表附入一债会资料，供债权人核查' }
            ]
          }
        ]
      },
      {
        id: 'first-creditors-meeting',
        name: '一债会召开',
        groups: [
          {
            id: 'meeting-participant-check',
            title: '核验参会主体与表决权',
            tasks: [
              { id: 'prepare-sign-in-sheet', title: '制作一债会签到表' },
              { id: 'prepare-receipt-sheet', title: '制作债权审核意见、债权表签收表' },
              { id: 'meeting-check-identity', title: '核验债权人及代理人的身份、授权文件、送达信息和表决权口径' },
              { id: 'prepare-meeting-packs', title: '按会议方式、参会人数及法院要求准备纸质或电子会议材料' }
            ]
          },
          {
            id: 'meeting-reports-claims',
            title: '报告履职并提交债权核查',
            tasks: [
              { id: 'meeting-report-performance', title: '报告管理人履职、接管调查、财产状况及下一步工作安排' },
              { id: 'meeting-report-remuneration', title: '报告法院确定的管理人报酬方案内容' },
              { id: 'meeting-submit-claims', title: '提交债权表供债权人会议核查，登记债务人、债权人提出的异议' },
              { id: 'meeting-answer-questions', title: '就债权、财产、费用及其他履职事项接受询问并记录答复' }
            ]
          },
          {
            id: 'meeting-deliberation-record',
            title: '组织审议表决并形成记录',
            tasks: [
              { id: 'meeting-deliberate-management', title: '提交债务人财产管理方案审议，记录意见和表决结果' },
              { id: 'meeting-other-agenda', title: '根据案件情况审议继续或停止营业、债权人委员会及其他依法应议事项' },
              { id: 'meeting-count-votes', title: '按各议题适用的法定规则统计、复核表决结果' },
              { id: 'meeting-make-record', title: '制作会议记录，归档签到、授权、报告、表决票和电子数据等材料' }
            ]
          }
        ]
      },
      {
        id: 'after-first-creditors-meeting',
        name: '一债会后',
        groups: [
          {
            id: 'vote-results',
            title: '收回表决票并公布表决结果',
            conditional: true,
            conditionText: '一债会没有表决内容时，可将本事项组标记为“不适用”。',
            tasks: [
              { id: 'collect-ballots', title: '收回并整理表决票' },
              { id: 'count-votes', title: '于表决截止时间统计表决结果' },
              { id: 'publish-vote-result', title: '在会议结束或表决期届满后三日内告知参与表决的债权人表决结果', detail: '采用能够确认收悉的方式告知，并留存发送、签收或电子数据记录。' }
            ]
          },
          {
            id: 'meeting-resolution-followup',
            title: '落实决议并处理程序问题',
            tasks: [
              { id: 'meeting-resolution-update-plans', title: '根据有效决议更新财产管理、营业及后续工作安排' },
              { id: 'meeting-resolution-file-court', title: '按案件要求向法院提交会议记录、表决统计和履职报告' },
              { id: 'meeting-resolution-track-challenge', title: '登记债权人对会议决议提出的撤销请求或其他程序异议并依法处理' }
            ]
          }
        ]
      },
      {
        id: 'valuation-and-audit',
        name: '评估、审计',
        groups: [
          {
            id: 'select-agencies',
            title: '确定并委托评估、审计等专业机构',
            conditional: true,
            conditionText: '根据启动资金、可处置财产及财务账册情况判断是否需要办理。',
            tasks: [
              { id: 'assess-agency-need', title: '判断是否需要评估、破产审计或专项审计' },
              { id: 'apply-random-selection', title: '核实法院及本案适用的机构选任、许可或报告程序并据此办理' },
              { id: 'confirm-primary-alternate', title: '核查候选机构资质、独立性、利益冲突、工作方案和人员配置' },
              { id: 'confirm-special-audit', title: '结合案件情况明确是否需要专项审计并记录判断依据' },
              { id: 'confirm-agency-fees', title: '签订书面委托协议，明确工作范围、完成时限、费用、成果交付和违约责任', detail: '相关费用拟列入破产费用时，还应核实并履行债权人会议同意、法院许可或本案要求的程序。' }
            ]
          }
        ]
      },
      {
        id: 'claims-verification',
        name: '债权核查与确认',
        groups: [
          {
            id: 'claims-supplement-and-review',
            title: '持续接收、审查债权并维护债权表',
            tasks: [
              { id: 'claims-log-supplemental', title: '登记补充申报债权，核实补充申报时间、材料和相应费用' },
              { id: 'claims-review-nature', title: '逐笔复核债权性质、数额、担保财产、诉讼时效及强制执行期间等事项' },
              { id: 'claims-update-table', title: '根据补充材料、核查意见及异议处理结果持续更新债权表' },
              { id: 'claims-preserve-files', title: '妥善保管债权申报登记册、债权表和申报材料，并依法安排查阅' }
            ]
          },
          {
            id: 'claims-objections',
            title: '处理债权异议与确认程序',
            conditional: true,
            conditionText: '债务人、债权人或其他有权主体对债权表有异议时办理。',
            tasks: [
              { id: 'claims-record-objection', title: '登记异议主体、异议债权、理由、依据及提出时间' },
              { id: 'claims-explain-adjust', title: '对异议作出解释，必要时补充调查并调整审核意见和债权表' },
              { id: 'claims-track-litigation', title: '异议经解释或调整仍未解决的，提示异议人在债权人会议核查结束后十五日内提起债权确认诉讼；有受理前仲裁协议的，提示向约定仲裁机构申请确认' },
              { id: 'claims-reflect-result', title: '依据生效裁判、仲裁结果或当事人处理结果更新债权表' }
            ]
          },
          {
            id: 'claims-court-confirmation',
            title: '提请法院确认无异议债权',
            tasks: [
              { id: 'claims-finalize-uncontested', title: '汇总债权人会议核查后无异议的债权及证明材料' },
              { id: 'claims-request-court-confirm', title: '向法院提交债权表并提请裁定确认无异议债权' },
              { id: 'claims-serve-confirmation', title: '登记确认裁定并按本案要求通知相关主体、更新工作台账' }
            ]
          },
          {
            id: 'employee-claims',
            title: '调查、公示并处理职工债权',
            conditional: true,
            conditionText: '债务人存在职工或工资、医疗伤残补助、抚恤、应划入个人账户的基本养老和基本医疗保险、法定补偿金等职工债权线索时办理，不以是否继续营业为前提。',
            tasks: [
              { id: 'employee-claims-investigate', title: '调取劳动合同、工资表、社保记录、考勤和离职资料，逐人调查职工债权' },
              { id: 'employee-claims-list', title: '编制职工债权清单，列明项目、期间、数额和计算依据' },
              { id: 'employee-claims-publish', title: '依法公示职工债权清单并保留公示记录' },
              { id: 'employee-claims-handle-objection', title: '登记职工异议，复核并更正；不予更正的，告知其依法提起诉讼的权利' }
            ]
          }
        ]
      },
      {
        id: 'property-takeover-recovery',
        name: '财产接管与追收',
        groups: [
          {
            id: 'property-inventory-control',
            title: '完善财产调查、接管与控制',
            tasks: [
              { id: 'property-inventory', title: '编制并持续更新债务人财产、负债、印章、证照、账簿和档案清册' },
              { id: 'property-bank-securities', title: '核查并控制银行账户、第三方支付、证券、股权及其他投资权益' },
              { id: 'property-litigation-execution', title: '全面调查未结诉讼、仲裁和执行案件并向相关办案机关报告破产受理情况' },
              { id: 'property-preserve-manage', title: '制定财产保管、保险、维护及必要开支安排，防止毁损和贬值' },
              { id: 'property-status-report', title: '形成并向法院、债权人会议提交债务人财产状况报告' }
            ]
          },
          {
            id: 'property-contracts-rights',
            title: '持续跟踪合同处理',
            tasks: [
              { id: 'property-pending-contracts', title: '跟踪接管初期已经决定解除或继续履行的合同，更新债权、共益债务、担保和履约台账' },
              { id: 'property-contract-disputes', title: '及时处理合同解除、继续履行、交付、结算及担保争议并控制期限' }
            ]
          },
          {
            id: 'property-retrieval-rights-group',
            title: '审查取回权请求',
            conditional: true,
            conditionText: '权利人主张一般取回权、出卖人取回权或所有权保留等权利时办理。',
            tasks: [
              { id: 'property-retrieval-rights', title: '登记请求时间、标的、权利依据和相关费用，审查是否符合取回条件' },
              { id: 'property-retrieval-decide', title: '作出并送达审查意见；不予认可或存在争议的，跟踪诉讼、仲裁及财产保管' }
            ]
          },
          {
            id: 'property-offset-rights-group',
            title: '审查抵销主张',
            conditional: true,
            conditionText: '债权人向管理人提出抵销主张，或发现受理前六个月内可能构成无效个别清偿的抵销时办理。',
            tasks: [
              { id: 'property-offset-rights', title: '登记抵销通知并审查互负债务、取得时间、担保及法定禁止抵销情形' },
              { id: 'property-offset-objection-deadline', title: '对抵销主张有异议的，在约定异议期限内或自收到通知之日起三个月内提起诉讼' },
              { id: 'property-offset-invalid-action', title: '对受理前六个月内涉嫌以特定抵销实施无效个别清偿的，自破产申请受理之日起三个月内评估并依法提起诉讼' }
            ]
          },
          {
            id: 'property-secured-rights-group',
            title: '核实担保权与优先受偿',
            conditional: true,
            conditionText: '债务人特定财产上存在抵押、质押、留置或其他法定优先权时办理。',
            tasks: [
              { id: 'property-secured-rights', title: '核实担保财产范围、权利顺位、价值及优先受偿范围' },
              { id: 'property-secured-treatment', title: '形成担保财产管理、维护、处置和优先受偿安排，并与普通债权部分分别记载' }
            ]
          },
          {
            id: 'property-avoidance-recovery',
            title: '调查并追回应收回财产',
            conditional: true,
            conditionText: '发现未缴出资、抽逃出资、可撤销行为、无效行为、非正常收入或侵占财产等线索时办理。',
            tasks: [
              { id: 'property-review-transactions', title: '审查受理前重点期间内的清偿、担保、无偿转让及低价交易等异常事项' },
              { id: 'property-contribution-recovery', title: '核查出资义务、抽逃出资及股东责任并制定追收方案' },
              { id: 'property-insider-recovery', title: '核查董监高非正常收入、侵占财产及其他损害债务人利益行为' },
              { id: 'property-demand-or-sue', title: '视情况发函催收、提起诉讼仲裁，或向有权法院申请保全以追回财产' }
            ]
          },
          {
            id: 'property-crime-referral-group',
            title: '违法犯罪线索处理',
            conditional: true,
            conditionText: '调查中发现涉嫌犯罪或严重违法的具体线索时办理。',
            tasks: [
              { id: 'property-crime-referral', title: '固定线索和证据，依法向法院报告并提请移送有关机关，跟踪财产追缴衔接' }
            ]
          },
          {
            id: 'property-business-employees',
            title: '营业与职工事项',
            conditional: true,
            conditionText: '债务人仍在营业、存在职工或需要处理劳动关系时办理。',
            tasks: [
              { id: 'property-business-decision', title: '评估继续或停止营业，并按程序取得法院许可或债权人会议决议' },
              { id: 'property-employee-roster', title: '核实留守或在岗职工、劳动关系、当期劳动报酬、社保及住房公积金情况' },
              { id: 'property-labor-relations', title: '依法处理劳动关系、档案社保转移及必要的稳定沟通' }
            ]
          },
          {
            id: 'expenses-common-benefit-ledger',
            title: '持续管理破产费用与共益债务',
            tasks: [
              { id: 'expenses-establish-ledger', title: '分别建立破产费用和共益债务台账，逐笔记录依据、审批、金额、支付和凭证' },
              { id: 'expenses-pay-currently', title: '依财产状况和法定顺序随时清偿，持续核对账户余额与必要后续支出' },
              { id: 'expenses-cash-warning', title: '滚动测算程序成本和现金缺口，及时向法院及监督主体报告重大变化' }
            ]
          },
          {
            id: 'expenses-insufficient-termination',
            title: '财产不足支付破产费用时提请终结',
            conditional: true,
            conditionText: '债务人财产不足以支付破产费用，且无利害关系人愿意垫付管理人报酬和执行职务费用等程序成本时办理。',
            tasks: [
              { id: 'expenses-confirm-insufficiency', title: '核实可用财产、已发生及预计费用、垫付意愿和继续程序的必要性' },
              { id: 'expenses-request-termination', title: '向法院提交财产与费用报告，依法提请终结破产程序' }
            ]
          },
          {
            id: 'ongoing-tax-compliance',
            title: '办理破产期间涉税事项',
            tasks: [
              { id: 'tax-bind-query', title: '按税务机关要求完成经办人员身份关联，查询债务人涉税状态、申报及欠税信息' },
              { id: 'tax-file-withhold-invoice', title: '管理人负责管理财产和营业事务时，代表债务人依法申报纳税、扣缴税费并办理发票事项' },
              { id: 'tax-classify-current', title: '将处置债务人财产发生的相关税费列入破产费用，将继续营业发生的相关税费列入共益债务并随时清偿' },
              { id: 'tax-preserve-records', title: '归档申报表、完税或清税资料、发票、沟通记录及税费台账' }
            ]
          },
          {
            id: 'ongoing-information-disclosure',
            title: '持续依法公开破产信息',
            tasks: [
              { id: 'disclosure-update-debtor', title: '在破产信息网及时更新依法应公开的债务人登记、年度报告、资产负债及诉讼仲裁基本信息' },
              { id: 'disclosure-update-manager', title: '及时公开管理人工作节点、公告、制作的程序文书及法院认可的分配方案等依法应公开信息' },
              { id: 'disclosure-confidentiality-review', title: '发布前审查国家秘密、个人隐私和商业秘密，依法作不公开、脱敏或限制披露处理' },
              { id: 'disclosure-preserve-proof', title: '留存发布版本、发布时间、访问或送达记录及更正记录' }
            ]
          }
        ]
      },
      {
        id: 'bankruptcy-declaration',
        name: '宣告破产与方案准备',
        groups: [
          {
            id: 'declaration-assessment',
            title: '评估程序走向并提请法院审查',
            tasks: [
              { id: 'declaration-restructuring-check', title: '核实是否存在重整、和解申请或其他不宜宣告破产的程序事项' },
              { id: 'declaration-conditions', title: '结合债权审核、财产调查及必要的审计评估，判断宣告破产条件' },
              { id: 'declaration-application', title: '向法院提交财产负债、破产原因及程序状态报告，提请法院依法审查是否宣告破产', detail: '宣告破产由人民法院依法裁定，管理人提交报告不表述为全国统一的独立申请义务。' },
              { id: 'declaration-order-record', title: '接收并登记破产宣告裁定，核对宣告后的程序影响' },
              { id: 'declaration-publication-notice', title: '核验并配合法院在裁定作出后十日内通知已知债权人和发布公告', detail: '通知已知债权人及公告的法定主体为人民法院。' }
            ]
          },
          {
            id: 'management-and-realization-plan',
            title: '拟订财产管理与变价方案',
            tasks: [
              { id: 'management-plan-draft', title: '根据财产性质、占有使用、维护成本和权利负担拟订财产管理方案' },
              { id: 'realization-plan-draft', title: '以价值最大化并兼顾处置效率为原则拟订破产财产变价方案' },
              { id: 'realization-method', title: '明确整体或分拆处置、拍卖或其他合法方式、底价与流拍后安排' },
              { id: 'major-disposal-reporting', title: '对重大财产处分明确先经债权人会议表决，并在实施前十日书面报告债权人委员会；未设债权人委员会的，报告法院' },
              { id: 'plan-submit-vote', title: '将管理、变价方案提交债权人会议表决并留存表决材料' }
            ]
          },
          {
            id: 'distribution-plan-preparation',
            title: '测算并拟订破产财产分配方案',
            tasks: [
              { id: 'distribution-costs-debts', title: '核定破产费用、共益债务、管理人报酬及已支付情况' },
              { id: 'distribution-secured-separate', title: '先单独核对特定财产担保权人的优先受偿额，未足额部分转列普通债权，剩余价款归入可分配财产' },
              { id: 'distribution-priority', title: '在可供普通分配财产中先清偿破产费用和共益债务，再按职工债权、其他社会保险费及税款、普通破产债权顺序测算' },
              { id: 'distribution-reserve', title: '识别附条件、未决诉讼、未受领等需要提存或预留的款项' },
              { id: 'distribution-draft', title: '拟订包含债权人、债权额、可分配财产、顺序、比例、数额和方法的分配方案' },
              { id: 'distribution-submit-vote', title: '将分配方案提交债权人会议讨论表决，并记录异议和处理结果' }
            ]
          }
        ]
      },
      {
        id: 'subsequent-creditors-meetings',
        name: '后续债权人会议',
        conditional: true,
        conditionText: '需再次审议债权、财产管理、变价、分配或其他重大事项时启用；简单案件可依法合并议题。',
        groups: [
          {
            id: 'subsequent-meeting-prep',
            title: '提议、通知并准备会议',
            tasks: [
              { id: 'subsequent-meeting-proposal', title: '确定召集事由、审议表决事项并按程序提议召开债权人会议' },
              { id: 'subsequent-meeting-notice', title: '至少提前十五日通知已知债权人会议时间和方式，并依适用规则及时提供具体审议、表决事项' },
              { id: 'subsequent-meeting-materials', title: '准备履职报告、方案文本、债权表、表决票及说明材料' },
              { id: 'subsequent-meeting-identity', title: '核验参会身份、代理权限及表决权口径' }
            ]
          },
          {
            id: 'subsequent-meeting-conduct',
            title: '召开、表决与后续处理',
            tasks: [
              { id: 'subsequent-meeting-record', title: '列席或协助召开会议，报告履职并制作、保存会议记录' },
              { id: 'subsequent-meeting-count', title: '按法定表决规则统计各议案结果并复核计算' },
              { id: 'subsequent-meeting-notify', title: '在会议召开后或表决期届满后三日内，将表决结果告知参与表决的债权人并留存记录' },
              { id: 'subsequent-meeting-implement', title: '根据有效决议或法院裁定更新方案和实施安排' }
            ]
          },
          {
            id: 'subsequent-meeting-court-ruling-group',
            title: '方案未通过后的法院裁定程序',
            conditional: true,
            conditionText: '财产管理或变价方案表决未通过，或者分配方案经二次表决仍未通过时办理。',
            tasks: [
              { id: 'subsequent-meeting-court-ruling', title: '按法定情形向法院提交方案、表决材料和说明，提请裁定并跟踪结果' },
              { id: 'subsequent-meeting-ruling-notice', title: '登记法院裁定，按本案要求通知债权人并提示法定复议期限' }
            ]
          }
        ]
      },
      {
        id: 'property-realization',
        name: '财产处置与变价',
        groups: [
          {
            id: 'realization-preparation',
            title: '处置前准备',
            tasks: [
              { id: 'realization-rights-check', title: '复核拟处置财产权属、占有、查封、担保、租赁和瑕疵情况' },
              { id: 'realization-value-update', title: '核对评估、询价或市场价值信息及有效期，必要时补充核验' },
              { id: 'realization-handover-materials', title: '整理产权资料、标的说明、税费承担和交付条件' },
              { id: 'realization-platform-plan', title: '依有效变价方案确定处置平台、方式、保留价及公告安排', detail: '依法以拍卖为原则；债权人会议另有决议的，从其决议。依法不得拍卖或限制转让的财产，按国家规定处理。' },
              { id: 'realization-major-report', title: '属于重大财产处分的，在实施前十日书面报告债权人委员会；未设债权人委员会的，报告法院' }
            ]
          },
          {
            id: 'realization-implementation',
            title: '实施处置并回收价款',
            tasks: [
              { id: 'realization-publish', title: '按有效变价方案履行相应公告、招募、展示、竞价或协议处置程序，并留存全过程记录' },
              { id: 'realization-bidding', title: '跟进竞价、成交确认、价款支付及必要的重新处置' },
              { id: 'realization-delivery', title: '完成标的交付、权属变更协助及交接记录' },
              { id: 'realization-funds', title: '核对处置价款进入管理人账户并登记税费、佣金等支出' },
              { id: 'realization-report', title: '向法院和债权人会议报告财产处置结果及与方案的符合情况' }
            ]
          },
          {
            id: 'secured-property-disposal',
            title: '担保财产处置与优先受偿',
            conditional: true,
            conditionText: '债务人财产上存在担保权或其他优先权时办理。',
            tasks: [
              { id: 'secured-disposal-coordinate', title: '与担保权人核对债权、担保范围和处置方式，评估单独或整体处置影响' },
              { id: 'secured-cost-allocation', title: '核定担保财产维护、变价等相关费用及承担口径' },
              { id: 'secured-payment', title: '依据确认结果实施优先受偿并记录剩余债权或剩余价款' }
            ]
          }
        ]
      },
      {
        id: 'property-distribution',
        name: '破产财产分配',
        groups: [
          {
            id: 'distribution-court-recognition',
            title: '提请法院认可分配方案',
            tasks: [
              { id: 'distribution-finalize', title: '依据有效表决、裁定及实际变价结果复核分配方案和计算表' },
              { id: 'distribution-request-recognition', title: '向法院提交分配方案、表决材料并提请裁定认可' },
              { id: 'distribution-account-check', title: '再次核验收款主体、账户、授权和税务票据要求，防止错付' }
            ]
          },
          {
            id: 'distribution-execution',
            title: '执行分配',
            tasks: [
              { id: 'distribution-notice', title: '向参加分配的债权人发送分配通知、金额明细和办理要求' },
              { id: 'distribution-pay', title: '按法院认可的方案实施一次或多次分配并保留支付凭证' },
              { id: 'distribution-announce-each', title: '实施多次分配时公告本次分配的财产额和债权额；最后分配时明确标注并载明附条件债权处理事项' },
              { id: 'distribution-reconcile', title: '逐笔核对银行流水、分配台账、剩余资金及会计记录' },
              { id: 'distribution-report-court', title: '最后分配完结后及时向法院提交分配执行报告' }
            ]
          },
          {
            id: 'distribution-conditional-deposit',
            title: '附条件债权分配额提存',
            conditional: true,
            conditionText: '分配时存在附生效条件或附解除条件的债权。',
            tasks: [
              { id: 'distribution-deposit-conditional', title: '提存附条件债权的分配额并单独记账' },
              { id: 'distribution-resolve-conditional', title: '在最后分配公告日按条件是否成就，依法向债权人交付或分配给其他债权人' }
            ]
          },
          {
            id: 'distribution-unclaimed-deposit',
            title: '未受领分配额提存',
            conditional: true,
            conditionText: '债权人无法受领、拒绝受领或未按通知领取分配额。',
            tasks: [
              { id: 'distribution-deposit-unclaimed', title: '提存未受领分配额，记录通知、账户核验和提存凭证' },
              { id: 'distribution-redistribute-unclaimed', title: '债权人自最后分配公告之日起满二个月仍不领取的，依法将提存额分配给其他债权人' }
            ]
          },
          {
            id: 'distribution-pending-case-deposit',
            title: '未决诉讼仲裁债权分配额提存',
            conditional: true,
            conditionText: '分配时存在诉讼或仲裁未决的债权。',
            tasks: [
              { id: 'distribution-deposit-pending-case', title: '按分配方案提存未决债权对应分配额并跟踪案件进展' },
              { id: 'distribution-resolve-pending-case', title: '裁判或仲裁结果确定后依法交付；程序终结满二年仍不能受领的，提请法院依法分配给其他债权人' }
            ]
          }
        ]
      },
      {
        id: 'termination-deregistration',
        name: '终结、注销与归档',
        groups: [
          {
            id: 'termination-application',
            title: '申请终结破产程序',
            tasks: [
              { id: 'termination-condition-check', title: '核查无财产可供分配、财产不足支付破产费用或最后分配完结等终结条件' },
              { id: 'termination-final-report', title: '汇总财产调查、债权确认、处置分配、费用报酬及遗留事项，制作终结履职报告' },
              { id: 'termination-request', title: '向法院提交终结破产程序申请及相应证明材料' },
              { id: 'termination-order', title: '接收、核对终结裁定及公告，登记裁定日期和后续期限' }
            ]
          },
          {
            id: 'deregistration-tasks',
            title: '办理注销及账户收尾',
            tasks: [
              { id: 'deregistration-tax', title: '持终结破产程序裁定等材料申请税务注销，取得清税文书并归档' },
              { id: 'deregistration-market', title: '自破产程序终结之日起十日内，持终结裁定向破产人原登记机关办理注销登记' },
              { id: 'deregistration-linked-items', title: '结合企业实际状态，依全国企业注销指引和有权机关流程办理社保、海关、分支机构、对外投资、受益所有人备案等关联收尾事项' },
              { id: 'deregistration-seals-accounts', title: '按规定处理证照、债务人账户、管理人账户及剩余款项' },
              { id: 'deregistration-notify', title: '向法院报告注销结果并通知需要知悉的相关主体' }
            ]
          },
          {
            id: 'manager-finalization',
            title: '管理人履职收尾与档案归档',
            tasks: [
              { id: 'manager-remuneration', title: '核对法院确定的管理人报酬、收取情况及相关凭证' },
              { id: 'manager-file-index', title: '整理法院文书、债权、财产、会议、收支、诉讼和送达等完整档案目录' },
              { id: 'manager-data-retention', title: '按保密、档案和数据安全要求归档纸质及电子材料并设置访问权限' },
              { id: 'manager-termination-status', title: '注销登记完成后向法院报告；无未决诉讼或仲裁的，登记管理人自注销完毕次日依法终止执行职务' }
            ]
          },
          {
            id: 'manager-pending-matters',
            title: '继续处理未决事项',
            conditional: true,
            conditionText: '注销登记完成时仍存在未决诉讼、仲裁、提存款处置或其他依法须继续履行的职责。',
            tasks: [
              { id: 'manager-handover-remaining', title: '制作未决诉讼、仲裁、提存及其他遗留事项清单，明确期限、负责人和资金保管方式' },
              { id: 'manager-continue-pending', title: '在注销后继续依法参与未决诉讼、仲裁并处理相应提存款，定期向法院报告' },
              { id: 'manager-pending-close', title: '遗留事项处理完毕后提交专项报告，核对职责终止状态' }
            ]
          },
          {
            id: 'manager-seal-destruction',
            title: '管理人印章销毁与备案',
            conditional: true,
            conditionText: '管理人已依法终止执行职务，且本案曾刻制管理人印章。',
            tasks: [
              { id: 'manager-destroy-seal', title: '将管理人印章交公安机关销毁' },
              { id: 'manager-file-destruction-proof', title: '取得销毁证明并送交法院，归入案件档案' }
            ]
          }
        ]
      },
      {
        id: 'post-termination-additional-distribution',
        name: '终结后追加分配',
        conditional: true,
        conditionText: '自依《企业破产法》第四十三条第四款或第一百二十条终结破产程序之日起二年内，发现依法应追回财产或其他可供分配财产时办理。',
        groups: [
          {
            id: 'additional-distribution-assessment',
            title: '核验追加财产和法定期限',
            tasks: [
              { id: 'additional-distribution-assess', title: '核实新增或追回财产的权属、数额、归集状态及终结日期，确认处于二年法定期间内' },
              { id: 'additional-distribution-cost-check', title: '测算追收、处置和分配费用；不足支付分配费用的，向法院报告并依法由法院上缴国库' },
              { id: 'additional-distribution-creditor-request', title: '提示有权债权人依法请求法院按照原破产财产分配方案追加分配，并协助提交财产线索和核验材料' }
            ]
          },
          {
            id: 'additional-distribution-execution',
            title: '依原分配方案实施追加分配',
            tasks: [
              { id: 'additional-distribution-plan', title: '依据法院认可的原破产财产分配方案核对受偿主体、顺序、比例和金额' },
              { id: 'additional-distribution-court', title: '向法院提交追加财产、成本及测算报告，依法取得相应裁定或办理指示' },
              { id: 'additional-distribution-execute', title: '依法公告或通知后实施追加分配，保留付款凭证并提交执行报告' }
            ]
          }
        ]
      }
    ]
  };

  const categories = [
    { id: 'bankruptcy', name: '破产案件' },
    { id: 'civil', name: '民事诉讼' },
    { id: 'criminal', name: '刑事诉讼' },
    { id: 'administrative', name: '行政诉讼' },
    { id: 'enforcement', name: '执行案件' },
    { id: 'non-litigation', name: '非诉专项' },
    { id: 'custom', name: '其他 / 自定义' }
  ];

  const templates = [template];

  return { template, templates, categories };
});
