(function exposeAdditionalTemplates(root, factory) {
  const value = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = value;
  else root.AdditionalWorkflowData = value;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createAdditionalTemplates() {
  // Compact source format:
  // stage = [id, name, groups, options?]
  // group = [id, title, tasks, options?]
  // task  = [id, title, options?]
  function buildTemplate(meta, stageDefinitions) {
    return {
      ...meta,
      sources: (meta.sources || []).map((source) => ({ ...source })),
      stages: stageDefinitions.map(([stageId, stageName, groupDefinitions, stageOptions = {}]) => ({
        ...stageOptions,
        id: stageId,
        name: stageName,
        groups: groupDefinitions.map(([groupId, groupTitle, taskDefinitions, groupOptions = {}]) => ({
          ...groupOptions,
          id: groupId,
          title: groupTitle,
          tasks: taskDefinitions.map(([taskId, taskTitle, taskOptions = {}]) => ({
            ...taskOptions,
            id: taskId,
            title: taskTitle
          }))
        }))
      }))
    };
  }

  const CIVIL_SOURCES = [
    {
      title: '全国人大常委会关于修改《中华人民共和国民事诉讼法》的决定（2023）',
      url: 'https://www.npc.gov.cn/npc/c2/c30834/202309/t20230901_431419.html'
    },
    {
      title: '最高人民法院关于适用《中华人民共和国民事诉讼法》的解释（2022修正）',
      url: 'https://www.court.gov.cn/zixun/xiangqing/353731.html'
    },
    {
      title: '最高人民法院关于民事诉讼证据的若干规定（2019修正）',
      url: 'https://www.court.gov.cn/zixun/xiangqing/212721.html'
    }
  ];

  const CRIMINAL_SOURCES = [
    {
      title: '中华人民共和国刑事诉讼法（2018修正）',
      url: 'https://www.npc.gov.cn/npc/c2/c12435/201905/t20190521_276591.html'
    },
    {
      title: '最高人民法院关于适用《中华人民共和国刑事诉讼法》的解释（2021）',
      url: 'https://www.court.gov.cn/zixun/xiangqing/286491.html'
    },
    {
      title: '人民检察院刑事诉讼规则（2019）',
      url: 'https://www.spp.gov.cn/spp/xwfbh/wsfbh/201912/t20191230_451490.shtml'
    },
    {
      title: '全国刑事法律援助服务规范（2023）',
      url: 'https://www.moj.gov.cn/pub/sfbgw/jgsz/jgszzsdw/zsdwflyzzx/flyzzxzcxx/zcxxzcfg/zcfggfxwj/202312/t20231208_491276.html'
    }
  ];

  const ADMINISTRATIVE_SOURCES = [
    {
      title: '中华人民共和国行政诉讼法（2017修正）',
      url: 'https://www.npc.gov.cn/zgrdw/npc/xinwen/2017-06/29/content_2024894.htm'
    },
    {
      title: '中华人民共和国行政复议法（2023修订）',
      url: 'https://flk.npc.gov.cn/detail?fileId=&id=ff8081818a21e6c3018a508d491a0c98&title=%E4%B8%AD%E5%8D%8E%E4%BA%BA%E6%B0%91%E5%85%B1%E5%92%8C%E5%9B%BD%E8%A1%8C%E6%94%BF%E5%A4%8D%E8%AE%AE%E6%B3%95&type='
    },
    {
      title: '最高人民法院关于适用《中华人民共和国行政诉讼法》的解释（2018）',
      url: 'https://www.court.gov.cn/zixun/xiangqing/80342.html'
    }
  ];

  const ENFORCEMENT_SOURCES = [
    {
      title: '最高人民法院关于适用《中华人民共和国民事诉讼法》执行程序若干问题的解释',
      url: 'https://www.court.gov.cn/zixun/xiangqing/704.html'
    },
    {
      title: '最高人民法院关于人民法院办理执行异议和复议案件若干问题的规定',
      url: 'https://www.court.gov.cn/zixun/xiangqing/14406.html'
    },
    {
      title: '最高人民法院关于严格规范终结本次执行程序的规定（试行）',
      url: 'https://gongbao.court.gov.cn/Details/85cc71552e82fd41bf5d350015bfdc.html'
    }
  ];

  const ADVISORY_SOURCES = [
    {
      title: '中华人民共和国律师法（2017修正）',
      url: 'https://www.npc.gov.cn/zgrdw/npc/xinwen/2017-09/12/content_2028697.htm'
    },
    {
      title: '中华人民共和国民法典',
      url: 'https://wb.flk.npc.gov.cn/flfg/PDF/bd53dd912c1048f2aecbaa229238334b.pdf'
    }
  ];

  const templates = [
    buildTemplate({
      id: 'civil-plaintiff-workflow-v1',
      name: '民事诉讼（原告）基础流程',
      category: 'civil',
      categoryLabel: '民事诉讼',
      description: '从接案评估、证据准备和起诉立案，到庭审、裁判及后续救济的原告侧基础清单。',
      role: '原告代理人',
      scope: '普通民事一审原告侧办理，并预留二审、执行与再审衔接；特别程序、涉外及专门案由须另行补充。',
      builtIn: true,
      sourceVersion: '2026-08-11',
      lastReviewedAt: '2026-08-12',
      legalNote: '本模板仅作通用办案提示，不构成法律意见。案件管辖、诉讼请求、举证责任及各项期限须按案由、法院通知和现行有效法律另行核实。',
      sources: CIVIL_SOURCES
    }, [
      ['civil-plaintiff-intake', '接案与诉讼评估', [
        ['civil-plaintiff-engagement', '委托与利益冲突', [
          ['civil-plaintiff-conflict-check', '完成委托人、对方当事人及关联主体的利益冲突检索'],
          ['civil-plaintiff-engagement-scope', '确认代理阶段、工作范围、费用及特别授权事项'],
          ['civil-plaintiff-client-identity', '核验委托人身份、主体资格及签约权限'],
          ['civil-plaintiff-file-opening', '签署委托手续并建立纸质、电子案件档案']
        ]],
        ['civil-plaintiff-merits', '请求与可行性评估', [
          ['civil-plaintiff-claim-interview', '访谈委托人并形成事实时间线和核心诉求'],
          ['civil-plaintiff-limitation-check', '核查诉讼时效、除斥期间及其他失权风险'],
          ['civil-plaintiff-jurisdiction-check', '核查受案范围、级别管辖、地域管辖及协议管辖'],
          ['civil-plaintiff-cost-benefit', '评估请求基础、证据缺口、成本、回收可能性及和解空间']
        ]]
      ]],
      ['civil-plaintiff-pretrial-evidence', '诉前证据与保全', [
        ['civil-plaintiff-evidence-plan', '证据整理', [
          ['civil-plaintiff-evidence-index', '按待证事实制作证据清单并核对原件、载体和来源'],
          ['civil-plaintiff-electronic-evidence', '固定聊天记录、邮件、平台数据等电子证据及形成过程'],
          ['civil-plaintiff-third-party-evidence', '识别需向第三方调取或申请法院调查收集的证据'],
          ['civil-plaintiff-witness-plan', '核实证人身份、证明事项及出庭申请需求', { optional: true }]
        ]],
        ['civil-plaintiff-preservation', '诉前保全措施', [
          ['civil-plaintiff-evidence-preservation', '判断并办理诉前证据保全或公证取证', { optional: true }],
          ['civil-plaintiff-property-preservation', '判断是否申请诉前财产保全并核实可供保全线索', { optional: true }],
          ['civil-plaintiff-preservation-security', '落实保全担保、申请材料及错误保全风险告知', { optional: true }],
          ['civil-plaintiff-prelitigation-demand', '视需要发出律师函、催告或提出调解方案', { optional: true }]
        ], { conditional: true, conditionText: '仅在存在证据灭失、财产转移风险或诉前沟通必要时办理。' }]
      ]],
      ['civil-plaintiff-filing', '起诉与立案', [
        ['civil-plaintiff-pleadings', '起诉材料', [
          ['civil-plaintiff-draft-complaint', '起草起诉状，明确当事人、事实理由和可执行的诉讼请求'],
          ['civil-plaintiff-calculate-claim', '复核本金、利息、违约金、损失及暂计截止日'],
          ['civil-plaintiff-filing-pack', '准备主体资格、授权、证据目录、送达地址确认等立案材料'],
          ['civil-plaintiff-fee-estimate', '测算案件受理费、保全费、鉴定费等诉讼成本']
        ]],
        ['civil-plaintiff-case-filing', '提交与跟进', [
          ['civil-plaintiff-submit-filing', '向有管辖权的法院提交立案申请并留存提交凭证'],
          ['civil-plaintiff-cure-filing', '跟进补正、管辖审查、调解分流及立案结果'],
          ['civil-plaintiff-pay-court-fee', '登记法院缴费通知并在指定期限内完成缴费'],
          ['civil-plaintiff-service-check', '核对案号、承办法官、送达方式及对方送达进度']
        ]]
      ]],
      ['civil-plaintiff-pretrial', '审理前准备', [
        ['civil-plaintiff-deadlines', '程序期限管理', [
          ['civil-plaintiff-docket-deadlines', '登记举证、证据交换、鉴定、开庭等期限并设置提醒'],
          ['civil-plaintiff-review-defense', '接收并分析答辩状、反诉材料和对方证据'],
          ['civil-plaintiff-supplement-evidence', '围绕争点补充证据并制作质证意见'],
          ['civil-plaintiff-procedural-applications', '办理调查取证、证人出庭、鉴定、勘验等申请', { optional: true }]
        ]],
        ['civil-plaintiff-hearing-plan', '庭前方案', [
          ['civil-plaintiff-issues-list', '制作争议焦点、要件事实、举证责任和证据对应表'],
          ['civil-plaintiff-settlement-authority', '与委托人确认调解底线、权限和方案', { optional: true }],
          ['civil-plaintiff-pretrial-conference', '参加庭前会议、证据交换或询问并记录法庭要求', { optional: true }]
        ]]
      ]],
      ['civil-plaintiff-hearing', '开庭审理', [
        ['civil-plaintiff-hearing-prep', '庭审准备', [
          ['civil-plaintiff-hearing-bundle', '整理庭审提纲、证据原件、代理手续及备用材料'],
          ['civil-plaintiff-client-prep', '向委托人说明庭审流程并核对本人陈述重点'],
          ['civil-plaintiff-witness-prep', '通知证人到庭并提示如实作证义务', { optional: true }]
        ]],
        ['civil-plaintiff-hearing-actions', '庭审办理', [
          ['civil-plaintiff-attend-hearing', '参加法庭调查、举证质证、法庭辩论及最后陈述'],
          ['civil-plaintiff-record-check', '核对庭审笔录，对遗漏或错误及时申请补正'],
          ['civil-plaintiff-post-hearing-brief', '按法庭要求提交补充证据、代理词或书面意见', { optional: true }]
        ]]
      ]],
      ['civil-plaintiff-judgment', '裁判与一审结案', [
        ['civil-plaintiff-judgment-review', '裁判处理', [
          ['civil-plaintiff-receive-judgment', '登记裁判文书送达日期并核对裁判主文'],
          ['civil-plaintiff-analyze-judgment', '分析事实认定、法律适用、费用负担及履行内容'],
          ['civil-plaintiff-appeal-advice', '书面提示上诉期限、利弊及后续方案'],
          ['civil-plaintiff-close-first-instance', '结算费用、移交文书并完成一审阶段工作记录']
        ]]
      ]],
      ['civil-plaintiff-appeal', '二审程序', [
        ['civil-plaintiff-appeal-group', '上诉与应诉', [
          ['civil-plaintiff-appeal-decision', '取得委托人是否上诉的明确决定并留存记录'],
          ['civil-plaintiff-draft-appeal', '在法定期限内起草、提交上诉状并办理缴费'],
          ['civil-plaintiff-appeal-evidence', '整理二审争点、新证据及未采纳意见'],
          ['civil-plaintiff-appeal-hearing', '参加二审询问、调解或开庭并提交代理意见'],
          ['civil-plaintiff-receive-final-judgment', '登记二审裁判送达、生效和履行事项']
        ]]
      ], { conditional: true, conditionText: '仅在提起上诉或对方上诉时启用。' }],
      ['civil-plaintiff-post-judgment', '执行与再审衔接', [
        ['civil-plaintiff-enforcement-handoff', '执行衔接', [
          ['civil-plaintiff-finality-check', '核实法律文书生效及对方履行情况'],
          ['civil-plaintiff-enforcement-materials', '整理申请执行材料、财产线索和金额计算表'],
          ['civil-plaintiff-enforcement-referral', '与委托人确认自行申请或转入执行代理']
        ], { conditional: true, conditionText: '义务人未按生效法律文书履行时办理。' }],
        ['civil-plaintiff-retrial', '再审与监督', [
          ['civil-plaintiff-retrial-assessment', '评估再审事由、申请期限和停止执行需求'],
          ['civil-plaintiff-retrial-filing', '经委托人决定后准备再审申请或检察监督材料', { optional: true }]
        ], { conditional: true, conditionText: '存在法定再审事由且委托人决定寻求审判监督救济时办理。' }]
      ], { conditional: true, conditionText: '根据履行情况及当事人救济选择启用。' }]
    ]),

    buildTemplate({
      id: 'civil-defendant-workflow-v1',
      name: '民事诉讼（被告）基础流程',
      category: 'civil',
      categoryLabel: '民事诉讼',
      description: '强调送达和答辩期限、程序抗辩、反诉举证及保全应对的被告侧基础清单。',
      role: '被告代理人',
      scope: '普通民事一审被告侧办理，并预留反诉、二审、执行应对与再审衔接；特别程序、涉外及专门案由须另行补充。',
      builtIn: true,
      sourceVersion: '2026-08-11',
      lastReviewedAt: '2026-08-12',
      legalNote: '本模板仅作通用办案提示，不构成法律意见。收到法院材料后应立即依送达文件核实答辩、举证、管辖异议、反诉及上诉等期限。',
      sources: CIVIL_SOURCES
    }, [
      ['civil-defendant-intake', '接案与期限控制', [
        ['civil-defendant-engagement', '委托建档', [
          ['civil-defendant-conflict-check', '完成当事人及关联主体利益冲突检索'],
          ['civil-defendant-identity-check', '核验委托人身份、主体资格、授权链及代理权限'],
          ['civil-defendant-sign-engagement', '签署委托手续并明确代理阶段、费用和工作边界'],
          ['civil-defendant-file-opening', '建立案件档案并保存法院送达材料原件']
        ]],
        ['civil-defendant-deadline-triage', '送达与期限', [
          ['civil-defendant-service-date', '核实起诉状、应诉通知等材料的实际送达日期和方式'],
          ['civil-defendant-deadline-calendar', '登记答辩、举证、管辖异议、反诉及开庭期限'],
          ['civil-defendant-client-interview', '访谈委托人并形成事实时间线、抗辩主张和材料清单'],
          ['civil-defendant-risk-advice', '初步评估责任风险、财产风险及和解空间']
        ]]
      ]],
      ['civil-defendant-procedure', '程序抗辩与保全应对', [
        ['civil-defendant-procedural-review', '程序审查', [
          ['civil-defendant-jurisdiction', '核查受案范围、管辖约定及是否提出管辖权异议'],
          ['civil-defendant-party-standing', '核查原被告主体、诉讼代表和第三人是否适格'],
          ['civil-defendant-duplicate-action', '核查重复起诉、仲裁协议、前置程序等程序障碍'],
          ['civil-defendant-recusal', '核查是否存在回避申请事项', { optional: true }]
        ]],
        ['civil-defendant-preservation-response', '保全应对', [
          ['civil-defendant-preservation-scope', '核对保全裁定、执行范围、标的价值及程序是否合法', { optional: true }],
          ['civil-defendant-preservation-remedy', '评估复议、置换担保、解除或变更保全方案', { optional: true }],
          ['civil-defendant-preservation-loss', '固定超额或错误保全造成损失的证据', { optional: true }]
        ], { conditional: true, conditionText: '仅在法院采取保全措施或存在保全风险时办理。' }]
      ]],
      ['civil-defendant-defense', '答辩、反诉与举证', [
        ['civil-defendant-defense-pleading', '答辩方案', [
          ['civil-defendant-elements-analysis', '按请求权基础拆解要件事实、举证责任和抗辩'],
          ['civil-defendant-draft-defense', '起草并在法院确定的期限内提交答辩状'],
          ['civil-defendant-admission-control', '与委托人核实拟承认事实并提示诉讼自认后果'],
          ['civil-defendant-counterclaim-review', '评估反诉条件、请求及与本诉的关联性', { optional: true }],
          ['civil-defendant-submit-counterclaim', '经确认后在适当期限内提交反诉材料并缴费', { optional: true }]
        ]],
        ['civil-defendant-evidence', '证据准备', [
          ['civil-defendant-evidence-index', '按抗辩事实制作证据目录并核对原件及来源'],
          ['civil-defendant-electronic-evidence', '完整固定电子数据、业务系统记录及形成过程'],
          ['civil-defendant-investigation-request', '办理法院调查取证、律师调查令等申请', { optional: true }]
        ]]
      ]],
      ['civil-defendant-pretrial', '审理前准备', [
        ['civil-defendant-evidence-exchange', '证据交换与申请', [
          ['civil-defendant-review-plaintiff-evidence', '逐项审查原告补充证据并形成质证提纲'],
          ['civil-defendant-rebuttal-evidence', '收集、提交反驳证据并说明逾期风险'],
          ['civil-defendant-expert-applications', '办理鉴定、评估、勘验、证人出庭等申请', { optional: true }],
          ['civil-defendant-third-party-join', '评估申请追加当事人或第三人参加诉讼', { optional: true }]
        ]],
        ['civil-defendant-hearing-plan', '庭前方案', [
          ['civil-defendant-issues-list', '制作争议焦点、证据对应表和庭审发问提纲'],
          ['civil-defendant-settlement-plan', '与委托人确认调解权限、底线和付款可行性', { optional: true }],
          ['civil-defendant-pretrial-conference', '参加庭前会议或证据交换并记录法庭要求', { optional: true }]
        ]]
      ]],
      ['civil-defendant-hearing', '开庭审理', [
        ['civil-defendant-hearing-prep', '庭审准备', [
          ['civil-defendant-hearing-bundle', '准备证据原件、授权材料、庭审提纲及备用文件'],
          ['civil-defendant-client-prep', '向委托人说明庭审流程及本人陈述注意事项'],
          ['civil-defendant-witness-prep', '通知证人到庭并提示如实作证义务', { optional: true }]
        ]],
        ['civil-defendant-hearing-actions', '庭审办理', [
          ['civil-defendant-attend-hearing', '参加法庭调查、质证、辩论、调解及最后陈述'],
          ['civil-defendant-record-check', '核对庭审笔录并及时申请补正遗漏或错误'],
          ['civil-defendant-post-hearing-submission', '按法庭要求提交代理词或补充意见', { optional: true }]
        ]]
      ]],
      ['civil-defendant-judgment', '裁判与一审结案', [
        ['civil-defendant-judgment-review', '裁判处理', [
          ['civil-defendant-receive-judgment', '登记裁判送达日期并核对主文、金额及费用负担'],
          ['civil-defendant-analyze-judgment', '分析事实认定、法律适用、履行义务及风险'],
          ['civil-defendant-appeal-advice', '书面提示上诉期限、利弊及履行或和解方案'],
          ['civil-defendant-close-first-instance', '结算费用、移交文书并完成一审工作记录']
        ]]
      ]],
      ['civil-defendant-appeal', '二审程序', [
        ['civil-defendant-appeal-group', '上诉与应诉', [
          ['civil-defendant-appeal-decision', '取得委托人是否上诉的明确决定并留存记录'],
          ['civil-defendant-draft-appeal', '在法定期限内提交上诉状并办理缴费'],
          ['civil-defendant-appeal-response', '对对方上诉形成二审答辩和争点清单'],
          ['civil-defendant-appeal-evidence', '整理二审新证据、程序异议及一审未采纳意见'],
          ['civil-defendant-appeal-hearing', '参加二审询问、调解或开庭并登记裁判结果']
        ]]
      ], { conditional: true, conditionText: '仅在本方或对方提起上诉时启用。' }],
      ['civil-defendant-post-judgment', '履行、执行与再审衔接', [
        ['civil-defendant-performance', '履行与执行应对', [
          ['civil-defendant-finality-check', '核实裁判生效时间、履行期限及应付款项'],
          ['civil-defendant-performance-plan', '协助制定主动履行、和解或执行应对方案'],
          ['civil-defendant-enforcement-response', '收到执行通知后登记期限并准备财产申报等材料', { optional: true }]
        ]],
        ['civil-defendant-retrial', '再审与监督', [
          ['civil-defendant-retrial-assessment', '评估再审事由、申请期限和停止执行需求'],
          ['civil-defendant-retrial-filing', '经委托人决定后准备再审申请或检察监督材料', { optional: true }]
        ], { conditional: true, conditionText: '存在法定再审事由且委托人决定寻求审判监督救济时办理。' }]
      ], { conditional: true, conditionText: '根据履行、执行及当事人救济选择启用。' }]
    ]),

    buildTemplate({
      id: 'criminal-defense-workflow-v1',
      name: '刑事诉讼（辩护）基础流程',
      category: 'criminal',
      categoryLabel: '刑事诉讼',
      description: '覆盖侦查、审查起诉、一二审及特别救济节点的刑事辩护基础清单。',
      role: '犯罪嫌疑人、被告人的辩护人',
      scope: '普通刑事案件辩护工作；羁押期限、特别程序、监察调查和法律援助个案规范须另行核验。',
      builtIn: true,
      sourceVersion: '2026-08-11',
      lastReviewedAt: '2026-08-12',
      legalNote: '本模板仅作刑事辩护通用提示，不能替代逐案法律判断。羁押、办案和救济期限必须以法律、案件文书及办案机关通知为准；认罪认罚、上诉等重大决定必须由本人在知情、自愿基础上作出。',
      sources: CRIMINAL_SOURCES
    }, [
      ['criminal-defense-intake', '接案与建档', [
        ['criminal-defense-engagement', '委托手续与初核', [
          ['criminal-defense-conflict-check', '完成犯罪嫌疑人、被告人、同案人员等利益冲突检索'],
          ['criminal-defense-authority-check', '核验委托人身份、近亲属关系或法律援助手续'],
          ['criminal-defense-scope-explain', '说明辩护范围、保密义务、禁止承诺结果及费用安排'],
          ['criminal-defense-sign-and-file', '签署委托手续并建立严格权限控制的案件档案'],
          ['criminal-defense-case-status', '核实涉嫌罪名、强制措施、羁押场所、承办机关和当前阶段']
        ]]
      ]],
      ['criminal-defense-investigation', '侦查阶段', [
        ['criminal-defense-meeting-investigation', '会见与权利保障', [
          ['criminal-defense-submit-procedure', '及时向办案机关提交辩护手续并确认联系人'],
          ['criminal-defense-first-meeting', '安排首次会见，核实身份、程序经过、身体状况和本人陈述'],
          ['criminal-defense-rights-explain', '向本人说明诉讼权利、如实供述边界及申诉控告渠道'],
          ['criminal-defense-meeting-record', '规范制作会见笔录并由本人核对确认'],
          ['criminal-defense-family-communication', '在合法和保密边界内向家属反馈可披露的程序信息']
        ]],
        ['criminal-defense-investigation-actions', '侦查应对', [
          ['criminal-defense-bail-review', '评估并办理变更、解除强制措施或取保候审申请', { optional: true }],
          ['criminal-defense-legal-opinion', '就定性、社会危险性或侦查取证问题提交辩护意见', { optional: true }],
          ['criminal-defense-evidence-leads', '收集、整理无罪罪轻证据线索并依法提交或申请调取'],
          ['criminal-defense-illegal-conduct-remedy', '对违法取证、超期羁押等依法提出申诉、控告或监督申请', { optional: true }],
          ['criminal-defense-deadline-track', '持续跟踪拘留、逮捕、侦查羁押及移送审查起诉节点']
        ]]
      ]],
      ['criminal-defense-prosecution', '审查起诉阶段', [
        ['criminal-defense-file-review', '阅卷与证据审查', [
          ['criminal-defense-prosecution-procedure', '向检察院提交手续并登记案号、承办人和期限'],
          ['criminal-defense-copy-file', '依法查阅、摘抄、复制案卷并落实卷宗保密'],
          ['criminal-defense-evidence-matrix', '制作指控事实、构成要件、证据能力与证明力对照表'],
          ['criminal-defense-meet-after-review', '阅卷后会见本人，逐项核实证据和辩解'],
          ['criminal-defense-supplement-investigation', '跟踪退回补充侦查及新增证据并及时补充审查', { optional: true }]
        ]],
        ['criminal-defense-prosecution-opinion', '审查起诉意见', [
          ['criminal-defense-written-opinion', '提交不起诉、罪轻、变更定性或程序事项的书面意见'],
          ['criminal-defense-hearing-request', '视情况申请当面听取意见、公开听证或调取证据', { optional: true }],
          ['criminal-defense-plea-explain', '向本人完整解释认罪认罚的指控事实、量刑建议、程序后果和反悔影响', { optional: true, detail: '律师应提供独立法律意见，不得替代本人选择，也不得以不当方式诱导认罪。' }],
          ['criminal-defense-plea-personal-decision', '确认认罪认罚系本人在知情、自愿基础上独立作出的决定', { optional: true, detail: '是否认罪认罚必须由犯罪嫌疑人、被告人本人决定；应如实记录咨询、本人意见及签署过程。' }],
          ['criminal-defense-plea-witness', '依法参加具结或提供见证法律帮助并核对文书内容', { optional: true }]
        ]]
      ]],
      ['criminal-defense-first-instance', '一审程序', [
        ['criminal-defense-trial-prep', '庭前准备', [
          ['criminal-defense-court-procedure', '向法院提交辩护手续并核实开庭、举证及庭前会议安排'],
          ['criminal-defense-update-review', '查阅法院阶段新增卷宗并再次会见被告人'],
          ['criminal-defense-strategy', '与被告人沟通辩护方向、争点和庭审程序'],
          ['criminal-defense-exclusion-request', '提出非法证据排除及相关线索、材料和申请', { optional: true }],
          ['criminal-defense-witness-expert', '申请证人、鉴定人、有专门知识的人出庭或调取证据', { optional: true }],
          ['criminal-defense-hearing-outline', '形成发问、质证、举证、辩论和量刑辩护提纲']
        ]],
        ['criminal-defense-trial', '出庭与裁判', [
          ['criminal-defense-attend-trial', '依法参加庭审，开展发问、质证、举证和辩论'],
          ['criminal-defense-protect-rights', '对限制辩护权或程序违法及时提出异议并要求记录'],
          ['criminal-defense-defense-statement', '提交辩护词及庭后补充意见', { optional: true }],
          ['criminal-defense-judgment-service', '会见或联系本人，核实判决送达日期并解释裁判内容'],
          ['criminal-defense-appeal-consult', '向本人说明上诉权、期限和风险，由本人决定是否上诉']
        ]]
      ]],
      ['criminal-defense-second-instance', '二审程序', [
        ['criminal-defense-appeal', '上诉与二审辩护', [
          ['criminal-defense-appeal-personal-decision', '确认上诉或撤回上诉系被告人本人真实决定'],
          ['criminal-defense-draft-appeal', '在法定期限内协助提交上诉状或接受二审委托'],
          ['criminal-defense-second-review', '查阅一审及二审新增材料并会见被告人'],
          ['criminal-defense-second-hearing-request', '依法申请开庭并说明需要调查的事实、证据或程序问题', { optional: true }],
          ['criminal-defense-second-opinion', '提交二审辩护意见并参加开庭、询问或听取意见'],
          ['criminal-defense-second-result', '登记二审裁判送达、生效及后续救济事项']
        ]]
      ], { conditional: true, conditionText: '仅在被告人上诉、检察机关抗诉或案件依法进入二审时启用。' }],
      ['criminal-defense-death-review', '死刑复核程序', [
        ['criminal-defense-death-review-group', '复核辩护', [
          ['criminal-defense-death-procedure', '提交辩护手续并核实复核程序及承办联系方式'],
          ['criminal-defense-death-meeting', '依法会见被告人并核实其意见和重要线索'],
          ['criminal-defense-death-file', '依法开展阅卷、证据复核和程序审查'],
          ['criminal-defense-death-opinion', '围绕事实证据、程序、刑罚适用提交复核辩护意见'],
          ['criminal-defense-death-result', '跟踪复核结果并依法向本人或委托人说明']
        ]]
      ], { conditional: true, conditionText: '仅适用于依法进入死刑复核程序的案件。' }],
      ['criminal-defense-enforcement', '生效裁判与执行衔接', [
        ['criminal-defense-enforcement-group', '执行衔接', [
          ['criminal-defense-finality', '核实裁判生效、交付执行和涉财产裁判事项'],
          ['criminal-defense-custody-credit', '核对羁押期限折抵、刑期起止和执行文书信息'],
          ['criminal-defense-property-enforcement', '提示并处理罚金、没收、退赔等涉财产执行衔接', { optional: true }],
          ['criminal-defense-community-correction', '提示缓刑、管制、假释等社区矫正报到事项', { optional: true }],
          ['criminal-defense-complaint-remedy', '说明申诉等救济不当然停止执行及后续委托范围']
        ]]
      ]],
      ['criminal-defense-close', '结案与归档', [
        ['criminal-defense-close-group', '结案管理', [
          ['criminal-defense-final-report', '制作结案报告，记录各阶段主要工作和处理结果'],
          ['criminal-defense-client-handover', '向本人或合法委托人移交可移交文书并完成签收'],
          ['criminal-defense-fee-settlement', '完成费用结算、法律援助结案或补贴手续'],
          ['criminal-defense-file-audit', '核对委托手续、会见笔录、法律意见和送达材料完整性'],
          ['criminal-defense-secure-archive', '按保密和档案规则归档、限制访问并登记保存期限']
        ]]
      ]]
    ]),

    buildTemplate({
      id: 'administrative-plaintiff-workflow-v1',
      name: '行政诉讼（原告）基础流程',
      category: 'administrative',
      categoryLabel: '行政诉讼',
      description: '从行政行为审查、复议选择到一二审、监督与履行的行政原告侧基础清单。',
      role: '行政诉讼原告代理人',
      scope: '行政相对人或利害关系人提起普通行政诉讼的基础办理；复议前置、行政协议及专门行政领域须逐案核验。',
      builtIn: true,
      sourceVersion: '2026-08-11',
      lastReviewedAt: '2026-08-12',
      legalNote: '本模板仅作通用提示。行政争议的受案范围、原告资格、适格被告、复议前置、起诉期限及举证规则高度依赖具体行政行为，必须逐案核实。',
      sources: ADMINISTRATIVE_SOURCES
    }, [
      ['administrative-plaintiff-intake', '接案与诉前评估', [
        ['administrative-plaintiff-engagement', '委托建档', [
          ['administrative-plaintiff-conflict-check', '完成委托人、行政机关及关联主体利益冲突检索'],
          ['administrative-plaintiff-identity', '核验委托人身份、主体资格和授权权限'],
          ['administrative-plaintiff-sign', '签署委托手续并建立案件档案'],
          ['administrative-plaintiff-interview', '形成行政行为、救济告知、送达及沟通的完整时间线']
        ]],
        ['administrative-plaintiff-admissibility', '可诉性审查', [
          ['administrative-plaintiff-act-identify', '准确识别被诉行政行为、不作为或行政协议争议'],
          ['administrative-plaintiff-standing', '核查原告利害关系及适格被告'],
          ['administrative-plaintiff-scope', '核查受案范围、管辖和是否存在复议前置'],
          ['administrative-plaintiff-time-limit', '核实申请复议、起诉期限及扣除、延长事由'],
          ['administrative-plaintiff-relief', '初步确定撤销、确认、履行、给付、赔偿等救济目标']
        ]]
      ]],
      ['administrative-plaintiff-reconsideration', '行政复议', [
        ['administrative-plaintiff-reconsideration-group', '复议申请与审理', [
          ['administrative-plaintiff-reconsideration-choice', '核实是否复议前置并评估直接诉讼或先行复议路径'],
          ['administrative-plaintiff-reconsideration-application', '准备并提交行政复议申请、证据和送达信息'],
          ['administrative-plaintiff-reconsideration-evidence', '审查被申请人答复及证据并提交补充意见'],
          ['administrative-plaintiff-reconsideration-hearing', '参加听证、听取意见或调解程序', { optional: true }],
          ['administrative-plaintiff-reconsideration-result', '登记复议决定送达并重新计算起诉期限']
        ]]
      ], { conditional: true, conditionText: '存在复议前置要求或经评估选择先行复议时启用。' }],
      ['administrative-plaintiff-filing', '起诉与立案', [
        ['administrative-plaintiff-complaint', '起诉材料', [
          ['administrative-plaintiff-defendant-check', '复核适格被告、管辖法院及共同诉讼主体'],
          ['administrative-plaintiff-draft-complaint', '起草起诉状并明确被诉行为及具体诉讼请求'],
          ['administrative-plaintiff-evidence-index', '整理行政行为、利害关系、期限和损害等初步证据'],
          ['administrative-plaintiff-norm-review-request', '评估是否一并请求审查规范性文件', { optional: true }],
          ['administrative-plaintiff-compensation-request', '量化行政赔偿、补偿请求并准备计算依据', { optional: true }]
        ]],
        ['administrative-plaintiff-submit', '提交与跟进', [
          ['administrative-plaintiff-file-case', '提交立案材料并留存提交、收件和补正凭证'],
          ['administrative-plaintiff-cure-filing', '跟进补正、登记立案、管辖移送或不予立案处理'],
          ['administrative-plaintiff-stop-enforcement', '评估申请停止行政行为执行或财产保全', { optional: true }]
        ]]
      ]],
      ['administrative-plaintiff-first-prep', '一审准备', [
        ['administrative-plaintiff-evidence-review', '答辩与证据审查', [
          ['administrative-plaintiff-deadlines', '登记答辩、举证、阅卷、庭前会议和开庭期限'],
          ['administrative-plaintiff-review-defense', '审查行政机关答辩、职权依据、程序和证据链'],
          ['administrative-plaintiff-burden-map', '制作合法性审查要素、举证责任和证据对应表'],
          ['administrative-plaintiff-supplement-evidence', '提交用于证明程序事实、损害和反驳理由的补充证据'],
          ['administrative-plaintiff-investigation-request', '申请调取行政案卷或其他无法自行取得的材料', { optional: true }]
        ]],
        ['administrative-plaintiff-hearing-plan', '庭审方案', [
          ['administrative-plaintiff-issues-list', '形成权限、事实、程序、法律依据及裁量争点清单'],
          ['administrative-plaintiff-resolution-plan', '评估协调化解或调解行政赔偿等方案', { optional: true }],
          ['administrative-plaintiff-hearing-bundle', '准备庭审提纲、证据原件和代理手续']
        ]]
      ]],
      ['administrative-plaintiff-first-judgment', '一审开庭与裁判', [
        ['administrative-plaintiff-hearing', '开庭办理', [
          ['administrative-plaintiff-attend-hearing', '参加庭审，围绕行政行为合法性开展质证和辩论'],
          ['administrative-plaintiff-record-check', '核对庭审笔录并及时申请补正'],
          ['administrative-plaintiff-post-hearing', '按法庭要求提交代理词或补充意见', { optional: true }]
        ]],
        ['administrative-plaintiff-judgment', '裁判处理', [
          ['administrative-plaintiff-receive-judgment', '登记裁判送达日期并核对主文、履行内容和期限'],
          ['administrative-plaintiff-analyze-judgment', '分析合法性审查、裁判方式及上诉必要性'],
          ['administrative-plaintiff-appeal-advice', '向委托人书面提示上诉期限和后续方案']
        ]]
      ]],
      ['administrative-plaintiff-appeal', '二审程序', [
        ['administrative-plaintiff-appeal-group', '上诉与二审', [
          ['administrative-plaintiff-appeal-decision', '取得委托人是否上诉的明确决定'],
          ['administrative-plaintiff-draft-appeal', '在法定期限内提交上诉状及相关材料'],
          ['administrative-plaintiff-second-issues', '整理二审争点、新证据及一审程序问题'],
          ['administrative-plaintiff-second-hearing', '参加询问、协调或开庭并提交代理意见'],
          ['administrative-plaintiff-second-result', '登记二审裁判送达、生效和履行事项']
        ]]
      ], { conditional: true, conditionText: '仅在本方或对方提起上诉时启用。' }],
      ['administrative-plaintiff-supervision', '再审与检察监督', [
        ['administrative-plaintiff-retrial', '监督救济', [
          ['administrative-plaintiff-retrial-grounds', '审查法定再审事由、申请期限及材料要求'],
          ['administrative-plaintiff-retrial-application', '经委托人决定后提交再审申请并跟进审查'],
          ['administrative-plaintiff-procuratorate', '评估并申请检察建议或抗诉监督', { optional: true }],
          ['administrative-plaintiff-petition-route', '整理信访申诉与诉讼救济边界并提示风险', { optional: true }]
        ]]
      ], { conditional: true, conditionText: '裁判生效后存在法定监督救济需求时启用。' }],
      ['administrative-plaintiff-performance', '履行、执行与结案', [
        ['administrative-plaintiff-performance-group', '裁判履行', [
          ['administrative-plaintiff-finality', '核实生效时间及行政机关履行内容、方式和期限'],
          ['administrative-plaintiff-performance-followup', '跟踪行政机关重新作出行为或履行给付义务'],
          ['administrative-plaintiff-enforcement', '对拒绝履行依法申请执行或采取法定督促措施', { optional: true }],
          ['administrative-plaintiff-client-handover', '向委托人移交裁判及履行材料并完成签收'],
          ['administrative-plaintiff-archive', '制作结案报告、结算费用并完成归档']
        ]]
      ]]
    ]),

    buildTemplate({
      id: 'enforcement-applicant-workflow-v1',
      name: '强制执行（申请执行人）基础流程',
      category: 'enforcement',
      categoryLabel: '执行案件',
      description: '围绕申请期限、财产调查控制、处置受偿和终本恢复的申请执行人侧基础清单。',
      role: '申请执行人代理人',
      scope: '民事执行申请与跟进；执行异议、参与分配、执行转破产等分支仅在符合条件时启用。',
      builtIn: true,
      sourceVersion: '2026-08-11',
      lastReviewedAt: '2026-08-12',
      legalNote: '本模板仅作通用执行提示。申请执行时效、管辖、执行依据、金额计算、优先权及异议救济须依生效文书和现行规则逐项核实。',
      sources: ENFORCEMENT_SOURCES
    }, [
      ['enforcement-applicant-eligibility', '执行条件审查', [
        ['enforcement-applicant-basis', '执行依据与期限', [
          ['enforcement-applicant-finality-check', '核实法律文书是否生效及是否具有明确给付内容'],
          ['enforcement-applicant-performance-check', '核实履行期限届满、实际履行及未履行范围'],
          ['enforcement-applicant-limitation', '计算申请执行时效并核查中止、中断情形'],
          ['enforcement-applicant-jurisdiction', '核查有管辖权的执行法院及财产所在地依据'],
          ['enforcement-applicant-amount-sheet', '制作本金、利息、迟延履行金和已付款项计算表']
        ]],
        ['enforcement-applicant-intake', '委托与线索', [
          ['enforcement-applicant-conflict-check', '完成申请执行人、被执行人及关联主体利益冲突检索'],
          ['enforcement-applicant-engagement', '签署执行代理手续并明确回款、和解等授权'],
          ['enforcement-applicant-property-interview', '访谈并收集被执行人身份、经营、资产和关联交易线索']
        ]]
      ]],
      ['enforcement-applicant-filing', '申请与立案', [
        ['enforcement-applicant-filing-pack', '申请材料', [
          ['enforcement-applicant-draft-application', '起草强制执行申请书并准确列明执行请求'],
          ['enforcement-applicant-proof-pack', '准备生效证明、主体资格、授权及送达地址材料'],
          ['enforcement-applicant-property-list', '制作财产线索清单并附权属、位置和价值依据'],
          ['enforcement-applicant-submit', '向执行法院提交申请并留存收件凭证'],
          ['enforcement-applicant-case-number', '跟进补正、立案并登记执行案号、承办团队和联系方式']
        ]]
      ]],
      ['enforcement-applicant-investigation', '财产调查与控制', [
        ['enforcement-applicant-search', '财产查控', [
          ['enforcement-applicant-network-search', '推动法院开展网络查控并核对反馈结果'],
          ['enforcement-applicant-offline-search', '补充调查不动产、车辆、股权、收益、到期债权等线索'],
          ['enforcement-applicant-affiliated-assets', '梳理关联主体、异常转让及可能规避执行的交易'],
          ['enforcement-applicant-report-property', '跟进责令报告财产及违反报告义务的处理'],
          ['enforcement-applicant-renew-seizure', '建立查封、扣押、冻结期限台账并申请续封']
        ]],
        ['enforcement-applicant-measures', '强制与控制措施', [
          ['enforcement-applicant-freeze', '申请及时查封、扣押、冻结已发现财产'],
          ['enforcement-applicant-consumption-restriction', '申请限制消费、纳入失信名单等措施', { optional: true }],
          ['enforcement-applicant-person-search', '提供被执行人下落并依法申请相应强制措施', { optional: true }],
          ['enforcement-applicant-crime-leads', '对涉嫌拒不执行判决、裁定的线索依法处理', { optional: true }]
        ]]
      ]],
      ['enforcement-applicant-disposal', '财产处置与受偿', [
        ['enforcement-applicant-valuation-sale', '评估与变价', [
          ['enforcement-applicant-title-obstacles', '核查权属、占有、租赁、担保和案外人权利障碍'],
          ['enforcement-applicant-valuation', '参与议价、询价或评估并核对财产范围与报告'],
          ['enforcement-applicant-auction', '跟踪拍卖、变卖、以物抵债及降价节点'],
          ['enforcement-applicant-maintenance-cost', '核实保管、腾退、税费等处置成本和承担方案']
        ]],
        ['enforcement-applicant-distribution', '回款与分配', [
          ['enforcement-applicant-priority', '核查优先权、轮候查封及参与分配条件'],
          ['enforcement-applicant-distribution-plan', '审查分配方案、执行费用和受偿顺序'],
          ['enforcement-applicant-receive-funds', '核对执行款到账、法院划付及委托人收款信息'],
          ['enforcement-applicant-balance', '更新未受偿余额和后续利息计算']
        ]]
      ]],
      ['enforcement-applicant-branches', '分支事项与救济', [
        ['enforcement-applicant-settlement', '执行和解', [
          ['enforcement-applicant-settlement-authority', '确认和解金额、履行安排、担保及授权边界'],
          ['enforcement-applicant-settlement-document', '起草执行和解协议并明确违约、恢复执行条款'],
          ['enforcement-applicant-settlement-track', '建立分期履行提醒并保存每笔付款凭证']
        ], { conditional: true, conditionText: '双方拟在执行程序中达成和解时办理。' }],
        ['enforcement-applicant-remedies', '异议与追加', [
          ['enforcement-applicant-execution-objection', '对违法或消极执行依法提出执行异议、复议或监督申请', { optional: true }],
          ['enforcement-applicant-third-party-objection', '应对案外人异议、复议或执行异议之诉', { optional: true }],
          ['enforcement-applicant-add-party', '审查并申请变更、追加被执行人', { optional: true }],
          ['enforcement-applicant-bankruptcy-transfer', '评估参与分配、执行转破产或另行破产申请路径', { optional: true }]
        ], { conditional: true, conditionText: '出现异议、追加主体、多债权竞合或资不抵债等情形时办理。' }]
      ], { conditional: true, conditionText: '根据案件进展选择适用的分支。' }],
      ['enforcement-applicant-closing', '结案、终本与恢复', [
        ['enforcement-applicant-close-method', '结案审查', [
          ['enforcement-applicant-close-calculation', '核对执行完毕、和解履行、终结执行等结案金额和依据'],
          ['enforcement-applicant-terminal-check', '终本前核对财产调查、控制措施及法院告知内容', { optional: true }],
          ['enforcement-applicant-terminal-opinion', '就终本提出意见并取得终本裁定', { optional: true }],
          ['enforcement-applicant-recovery-docket', '终本后持续记录新财产线索、续封节点和恢复执行条件', { optional: true }],
          ['enforcement-applicant-restore', '发现可供执行财产后及时申请恢复执行', { optional: true }],
          ['enforcement-applicant-final-report', '制作结案报告、移交材料、结算费用并归档']
        ]]
      ]]
    ]),

    buildTemplate({
      id: 'nonlitigation-project-workflow-v1',
      name: '非诉专项基础流程',
      category: 'non-litigation',
      categoryLabel: '非诉专项',
      description: '适用于一般法律专项、交易支持和合规项目的启动、尽调、方案、文件与交付清单。',
      role: '非诉项目承办团队',
      scope: '通用尽调、合规与交易支持项目管理；具体交易结构、行业监管、税务及审批事项须另设专项清单。',
      builtIn: true,
      sourceVersion: '2026-08-11',
      lastReviewedAt: '2026-08-12',
      legalNote: '本模板为通用项目管理框架，不能替代对具体交易类型、行业监管、审批备案、税务、数据和反垄断等专项规则的核查。',
      sources: ADVISORY_SOURCES
    }, [
      ['nonlitigation-project-initiation', '项目启动', [
        ['nonlitigation-project-engagement', '立项与委托', [
          ['nonlitigation-project-conflict-check', '完成客户、交易对手、目标主体及关联方利益冲突检索'],
          ['nonlitigation-project-client-check', '核验客户身份、委托权限和实际需求'],
          ['nonlitigation-project-scope', '明确服务范围、排除事项、成果形式、费用和进度'],
          ['nonlitigation-project-engagement-letter', '签署委托合同、保密文件并完成内部立项'],
          ['nonlitigation-project-team', '确定项目负责人、分工、复核人和沟通机制']
        ]],
        ['nonlitigation-project-plan', '工作计划', [
          ['nonlitigation-project-milestones', '建立关键里程碑、依赖事项和责任人台账'],
          ['nonlitigation-project-stakeholders', '确认客户、对手方、中介机构和决策人的联系清单'],
          ['nonlitigation-project-data-room', '约定资料传输、权限、命名和版本控制规则']
        ]]
      ]],
      ['nonlitigation-project-diligence', '资料收集与尽调', [
        ['nonlitigation-project-document-request', '资料收集', [
          ['nonlitigation-project-request-list', '根据项目范围发送分层资料清单'],
          ['nonlitigation-project-receipt-log', '建立资料收件、缺失、更新和责任人台账'],
          ['nonlitigation-project-authenticity', '核查资料完整性、一致性、签章及来源'],
          ['nonlitigation-project-interviews', '访谈业务、财务、管理层或其他关键人员', { optional: true }]
        ]],
        ['nonlitigation-project-due-diligence', '核查与问题清单', [
          ['nonlitigation-project-public-search', '开展主体登记、诉讼执行、许可资质等公开检索'],
          ['nonlitigation-project-material-contracts', '审查重大合同、权利负担和关键义务'],
          ['nonlitigation-project-compliance', '按项目范围核查治理、劳动、数据、知识产权等事项'],
          ['nonlitigation-project-qna', '形成问题清单并跟踪补充资料和书面回复'],
          ['nonlitigation-project-red-flags', '及时报告可能影响交易或决策的重大风险']
        ]]
      ]],
      ['nonlitigation-project-analysis', '法律分析与方案', [
        ['nonlitigation-project-structure', '交易或事项方案', [
          ['nonlitigation-project-objectives', '复核商业目标、法律约束和不可妥协事项'],
          ['nonlitigation-project-options', '比较可行路径、前提、成本、周期和主要风险'],
          ['nonlitigation-project-approvals', '识别内部决策、第三方同意及审批备案事项'],
          ['nonlitigation-project-risk-matrix', '制作风险分级、责任主体和缓释措施矩阵'],
          ['nonlitigation-project-client-decision', '向客户汇报关键判断并取得方案确认']
        ]]
      ]],
      ['nonlitigation-project-documents', '文件起草与谈判', [
        ['nonlitigation-project-drafting', '文件制作', [
          ['nonlitigation-project-document-list', '确定主协议、附件、决议、交割文件及配套清单'],
          ['nonlitigation-project-first-draft', '起草或审阅首轮文件并标注商业待确认事项'],
          ['nonlitigation-project-internal-review', '完成内部复核并统一定义、金额和交叉引用'],
          ['nonlitigation-project-version-control', '维护清洁版、修订版和议题清单的版本对应']
        ]],
        ['nonlitigation-project-negotiation', '谈判与定稿', [
          ['nonlitigation-project-negotiation-plan', '确认谈判底线、可交换条件和授权层级'],
          ['nonlitigation-project-negotiate-session', '参加谈判并实时更新议题清单'],
          ['nonlitigation-project-open-issues', '将重大未决风险及时升级至客户决策'],
          ['nonlitigation-project-final-documents', '形成待签署文件并完成一致性、附件和签署页核对']
        ]]
      ]],
      ['nonlitigation-project-closing', '交割与成果交付', [
        ['nonlitigation-project-closing-prep', '交割准备', [
          ['nonlitigation-project-closing-checklist', '建立先决条件、交付物、责任人和完成状态清单'],
          ['nonlitigation-project-signing-authority', '核验各方签署权限、决议和签署方式'],
          ['nonlitigation-project-conditions', '核实审批、同意、付款等先决条件满足或豁免'],
          ['nonlitigation-project-signature', '组织签署并核对签章、日期、份数和文本一致性']
        ]],
        ['nonlitigation-project-delivery', '成果交付', [
          ['nonlitigation-project-closing-deliverables', '完成交割文件交换、资金或权利交付确认'],
          ['nonlitigation-project-legal-deliverable', '按约定提交法律意见、报告或其他工作成果'],
          ['nonlitigation-project-closing-set', '汇编最终签署文本、附件和交割凭证']
        ]]
      ]],
      ['nonlitigation-project-followup', '后续管理与归档', [
        ['nonlitigation-project-post-closing', '后续事项', [
          ['nonlitigation-project-post-closing-list', '登记交割后义务、备案、付款和补充文件期限'],
          ['nonlitigation-project-remediation', '跟进遗留问题、承诺事项和风险整改'],
          ['nonlitigation-project-client-handover', '向客户移交最终成果并取得签收或确认'],
          ['nonlitigation-project-final-report', '制作项目总结并记录关键决策和保留意见'],
          ['nonlitigation-project-fee-close', '完成工时、费用和第三方支出结算'],
          ['nonlitigation-project-archive', '按保密、数据安全和档案规则归档或销毁副本']
        ]]
      ]]
    ]),

    buildTemplate({
      id: 'contract-review-workflow-v1',
      name: '合同审查基础流程',
      category: 'non-litigation',
      categoryLabel: '非诉专项',
      description: '覆盖合同接收、商务要素、法律风险、修改谈判及签署履行的日常审查清单。',
      role: '委托方合同审查人员',
      scope: '通用商业合同审查；具体合同类型、谈判地位、行业监管及客户内部审批要求须逐项补充。',
      builtIn: true,
      sourceVersion: '2026-08-11',
      lastReviewedAt: '2026-08-12',
      legalNote: '本模板是通用合同审查清单。具体合同还应结合交易类型、强制性规定、行业监管、税务、数据、知识产权及客户内控制度专项审查。',
      sources: ADVISORY_SOURCES
    }, [
      ['contract-review-intake', '接收与审查准备', [
        ['contract-review-request', '需求确认', [
          ['contract-review-latest-version', '确认待审文本为最新完整版本并收齐附件、技术文件和历史修改'],
          ['contract-review-business-background', '了解交易背景、业务目标、时间要求及合作进展'],
          ['contract-review-parties', '核实合同主体、经办人、签署人及关联交易关系'],
          ['contract-review-scope', '明确审查范围、重点风险、输出形式及业务负责人'],
          ['contract-review-conflict', '必要时完成交易对手及关联主体利益冲突检索', { optional: true }]
        ]]
      ]],
      ['contract-review-commercial', '基础与商务条款', [
        ['contract-review-commercial-terms', '交易要素核对', [
          ['contract-review-subject', '核对标的、数量、质量、规格、服务范围和验收标准'],
          ['contract-review-price', '核对价款、税费、发票、结算条件和付款节点'],
          ['contract-review-performance', '核对履行期限、地点、方式、交付物及配合义务'],
          ['contract-review-authority', '核查主体资格、经营资质、授权及内部审批要求'],
          ['contract-review-business-consistency', '确认合同文本与报价、招投标文件及谈判结论一致']
        ]]
      ]],
      ['contract-review-risk', '法律风险与核心条款', [
        ['contract-review-validity', '效力与权利安排', [
          ['contract-review-validity-rules', '审查合同效力、强制性规定、审批备案及生效条件'],
          ['contract-review-rights-obligations', '检查双方权利义务是否完整、清晰、对等且可履行'],
          ['contract-review-ip-data', '审查知识产权、数据、保密及成果归属', { optional: true }],
          ['contract-review-assignment', '审查转让、分包、控制权变更及第三方权利限制', { optional: true }]
        ]],
        ['contract-review-remedies', '责任与退出', [
          ['contract-review-breach', '审查违约情形、责任形式、责任上限及损失计算'],
          ['contract-review-guarantee', '审查保证、担保、保证金、保险等履约保障', { optional: true }],
          ['contract-review-change-termination', '审查变更、解除、终止、暂停及退出机制'],
          ['contract-review-force-majeure', '审查不可抗力、情势变化及通知减损义务'],
          ['contract-review-dispute', '审查适用法律、争议解决、管辖或仲裁条款'],
          ['contract-review-notice', '审查通知送达、联系人变更及电子送达约定']
        ]]
      ]],
      ['contract-review-revision', '修改、沟通与谈判', [
        ['contract-review-markup', '审查意见输出', [
          ['contract-review-redline', '形成修订版并保持定义、编号和交叉引用一致'],
          ['contract-review-issue-list', '制作风险分级清单并提出可执行的替代文本'],
          ['contract-review-business-confirmation', '将商业判断、金额和履行安排交业务部门确认'],
          ['contract-review-internal-approval', '对重大偏离或保留风险取得有权限人员批准']
        ]],
        ['contract-review-negotiation', '谈判与定稿', [
          ['contract-review-negotiation-brief', '确认谈判优先级、底线和可交换条件'],
          ['contract-review-negotiate', '参加谈判并持续更新未决事项'],
          ['contract-review-final-compare', '对最终清洁版与已同意修订逐项比对'],
          ['contract-review-finalize', '清理批注、空白项和版本信息并形成待签版']
        ]]
      ]],
      ['contract-review-signing', '签署与履行管理', [
        ['contract-review-execution', '签署生效', [
          ['contract-review-approval-complete', '确认内部审批、预算及签署授权已完成'],
          ['contract-review-signature-check', '核对签署主体、签署方式、签章、日期、份数和骑缝'],
          ['contract-review-condition-precedent', '核实生效条件和先决条件是否满足或豁免'],
          ['contract-review-counterpart', '收回各方完整签署文本并确认文本一致']
        ]],
        ['contract-review-performance-docket', '履行台账', [
          ['contract-review-obligation-calendar', '提取付款、交付、验收、通知、续约等关键节点'],
          ['contract-review-guarantee-calendar', '登记担保、保证金、保险和权利续期节点', { optional: true }],
          ['contract-review-change-record', '将补充协议、变更单和往来确认纳入同一档案'],
          ['contract-review-archive', '归档签署版、审批记录及重要沟通材料']
        ]]
      ]]
    ])
  ];

  return { templates, buildTemplate };
});
