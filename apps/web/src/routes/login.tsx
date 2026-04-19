import { useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { Button } from "@workspace/ui/components/button"
import { Card, CardContent } from "@workspace/ui/components/card"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { Checkbox } from "@workspace/ui/components/checkbox"
import { Separator } from "@workspace/ui/components/separator"
import {
  IconEye,
  IconEyeOff,
  IconLoader2,
  IconSettings,
  IconX,
} from "@tabler/icons-react"

import logoImage from "@/assets/logo.svg"
import bgImage from "@/assets/Group.png"

export const Route = createFileRoute("/login")({
  component: LoginPage,
})

function LoginPage() {
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [rememberMe, setRememberMe] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    // TODO: 对接登录 API
    setTimeout(async () => {
      const res = {
        code: 1,
        result: [
          {
            id: 1,
            name: "系统管理员",
            username: "bbadmin",
            menuid: "1",
            orgType: null,
            orgNo: null,
            email: "ca@greg.co",
            phoneNumber: "13720349091",
            expirationTime: null,
            status: "1",
            loginTime: "2026-04-07 06:32:11",
            changePwdTime: "2026-04-07 06:21:05",
            inTime: null,
            inIp: null,
            consInfo: {},
            dpts: [
              {
                id: 10,
                name: "爱可生",
                parentId: null,
                description: null,
                createTime: null,
                updateTime: null,
                status: "1",
              },
            ],
          },
        ],
        noMenus: false,
        token:
          "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ0aWQiOjEsIm1lbnVpZCI6IjEiLCJ1c2VybmFtZSI6ImJiYWRtaW4iLCJvcmdObyI6bnVsbCwib3JnVHlwZSI6bnVsbCwiZHB0SWRzIjoiMTAiLCJsb2dpbklwIjoiMTAuMTcyLjI0Ni4xNDQiLCJjaGFuZ2VQd2RUaW1lIjoiMjAyNi0wNC0wNyAwNjoyMTowNSIsImV4cFRpbWUiOjE3OTYyODE1NDk1NTksImlhdCI6MTc3NTU0NTU0OSwiZXhwIjoxNzc2NDA5NTQ5fQ.ViBSPVwb7tRfFRWQ1uj-BtfY_t_EwNIgNWsooWvaVTQ",
        msg: "",
      }
      const token = res.token
      const user = res.result[0]

      // 写入 localStorage（request.ts 的 getAuthToken() 从这里读取）
      localStorage.setItem("token", token)

      // 通过 IPC 持久化到 electron-store（仅 Electron 环境）
      await window.electronApi?.saveAuth(
        token,
        user as unknown as Record<string, unknown>,
        rememberMe
      )

      // 通知主进程：关闭登录窗口，打开主窗口
      await window.electronApi?.loginSuccess()

      setLoading(false)
    }, 1500)
  }
  const isElectron = !!window.electronApi
  return (
    <div
      className="relative h-screen w-screen overflow-hidden"
      style={
        {
          background: `url(${bgImage}) no-repeat 100% 0%, linear-gradient(180deg, #eaf0fd 1%, rgba(236, 242, 255, 0.74) 27%, rgba(255, 255, 255, 0) 83%)`,
          WebkitAppRegion: "drag",
        } as React.CSSProperties
      }
    >
      {/* 右上角按钮 */}
      {isElectron && (
        <div
          className="absolute top-0 right-0 z-10 flex items-center"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          <button
            type="button"
            title="通信设置"
            className="p-2 text-gray-700 hover:bg-gray-300"
          >
            <IconSettings className="size-5" />
          </button>
          <button
            type="button"
            title="关闭"
            className="p-2 text-gray-700 hover:bg-destructive hover:text-white"
            onClick={() => window.electronApi?.quitApp()}
          >
            <IconX className="size-5" />
          </button>
        </div>
      )}
      {/* 左上角 Logo + 名称 */}
      <div className="flex items-center px-4 pt-4 select-none">
        <img src={logoImage} alt="DigitalEmployee" className="h-7 w-7" />
        <h1 className="ml-2 text-base font-semibold tracking-wider text-gray-800">
          数字员工
        </h1>
      </div>

      <div className="flex flex-col items-center justify-center px-6 pt-10">
        <h3 className="mb-6 text-xl font-bold">欢迎回来</h3>

        <div
          className="w-full max-w-sm"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="username" className="text-sm font-bold">
                账号
              </Label>
              <Input
                id="username"
                type="text"
                placeholder="请输入你的用户名"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                disabled={loading}
                autoFocus
              />
            </div>

            <div className="flex flex-col gap-1">
              <Label htmlFor="password" className="text-sm font-bold">
                密码
              </Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="请输入你的密码"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pr-8"
                  autoComplete="current-password"
                  disabled={loading}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground disabled:cursor-not-allowed"
                  tabIndex={-1}
                  disabled={loading}
                >
                  {showPassword ? (
                    <IconEyeOff className="size-3.5" />
                  ) : (
                    <IconEye className="size-3.5" />
                  )}
                </button>
              </div>
            </div>

            <div className="flex items-center gap-4 py-1">
              <div className="flex items-center gap-1">
                <Checkbox
                  id="remember"
                  checked={rememberMe}
                  onCheckedChange={(checked) => setRememberMe(checked === true)}
                  disabled={loading}
                />
                <Label htmlFor="remember" className="cursor-pointer text-sm">
                  记住密码
                </Label>
              </div>
            </div>

            <Button
              type="submit"
              className="w-full"
              size="lg"
              disabled={loading || !username || !password}
            >
              {loading && <IconLoader2 className="mr-2 size-4 animate-spin" />}
              {loading ? "登录中..." : "登录"}
            </Button>
          </form>
          <p className="mt-2 w-full text-center text-xs text-muted-foreground">
            还没有账号?{" "}
            <span className="cursor-pointer text-primary">联系管理员</span>
          </p>
        </div>
      </div>
    </div>
  )
}
