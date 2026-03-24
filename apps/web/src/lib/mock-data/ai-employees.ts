export interface AIEmployee {
  id: string
  name: string
  role: string
  avatar?: string
  status: "online" | "busy" | "offline"
  specialty: string
}

export type ContactType = "employee" | "group"

export interface Contact {
  type: ContactType
  employee?: AIEmployee
  group?: {
    id: string
    name: string
    participants: AIEmployee[]
  }
}

export const AI_EMPLOYEES: AIEmployee[] = [
  {
    id: "hr-manager",
    name: "陈小红",
    role: "HR经理",
    status: "online",
    avatar: "https://api.dicebear.com/9.x/avataaars/svg?seed=Alice",
    specialty: "员工关系、福利政策、招聘流程",
  },
  {
    id: "chief-engineer",
    name: "王大明",
    role: "首席工程师",
    status: "busy",
    avatar: "https://api.dicebear.com/9.x/avataaars/svg?seed=Bob",
    specialty: "技术架构、代码审查、基础设施",
  },
  {
    id: "product-designer",
    name: "李晓琳",
    role: "产品设计师",
    status: "online",
    avatar: "https://api.dicebear.com/9.x/avataaars/svg?seed=Charlie",
    specialty: "UX设计、用户研究、原型制作",
  },
  {
    id: "marketing-director",
    name: "赵伟",
    role: "营销总监",
    status: "offline",
    avatar: "https://api.dicebear.com/9.x/avataaars/svg?seed=David",
    specialty: "品牌策略、营销活动、数据分析",
  },
]

export const AI_GROUPS = [
  {
    id: "group-tech",
    name: "技术讨论群",
    participants: [
      AI_EMPLOYEES[1], // 王大明
      AI_EMPLOYEES[3], // 赵伟
    ],
  },
  {
    id: "group-product",
    name: "产品讨论群",
    participants: [
      AI_EMPLOYEES[1], // 王大明
      AI_EMPLOYEES[2], // 李晓琳
      AI_EMPLOYEES[0], // 陈小红
    ],
  },
]

export const CONTACTS: Contact[] = [
  ...AI_EMPLOYEES.map((emp) => ({
    type: "employee" as const,
    employee: emp,
  })),
  ...AI_GROUPS.map((group) => ({
    type: "group" as const,
    group,
  })),
]

export const getContactById = (id: string): Contact | undefined => {
  return CONTACTS.find((contact) => {
    if (contact.type === "employee") {
      return contact.employee?.id === id
    }
    return contact.group?.id === id
  })
}

export const getEmployeeById = (id: string): AIEmployee | undefined => {
  return AI_EMPLOYEES.find((emp) => emp.id === id)
}

export const getGroupById = (id: string) => {
  return AI_GROUPS.find((group) => group.id === id)
}
