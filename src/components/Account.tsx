/* eslint-disable react/prop-types */
import { App, Avatar, Form, Input, Modal } from 'antd';
import React, { useEffect, useState } from 'react';
import { useAppStateStore } from '../stores/app-state';
import { getAccountInfo } from '../twitter/api';
import { TwitterAccountInfo } from '../interfaces/TwitterAccountInfo';
import { LogoutOutlined, QuestionCircleOutlined } from '@ant-design/icons';
import FormItem from 'antd/es/form/FormItem';
import { useForm } from 'antd/es/form/Form';
import { parseCookie, stringifyCookie } from '../utils/cookie';
import clsx from 'clsx';
import { CachedAvatar } from './CachedAvatar';

export const Account: React.FC = () => {
  const [cookieString, setCookieString] = useAppStateStore((state) => [
    state.cookieString,
    state.setCookieString,
  ]);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalLoading, setModalLoading] = useState(false);
  const [accountInfo, setAccountInfo] = useState<TwitterAccountInfo | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [rawCookie, setRawCookie] = useState('');
  const [form] = useForm();
  const { message } = App.useApp();

  useEffect(() => {
    (async () => {
      if (!cookieString) {
        setAccountInfo(null);
      } else {
        setLoading(true);
        try {
          const accountInfo = await getAccountInfo(cookieString);
          setAccountInfo(accountInfo);
        } catch (err: any) {
          message.error('获取账号信息失败，请检查 Cookie 或代理配置是否正确');
          log.error(err);
        } finally {
          setLoading(false);
        }
      }
    })();
  }, [cookieString]);

  const applyCookieAndLogin = async (nextCookie: string) => {
    const parsed = parseCookie(nextCookie);
    if (!parsed.auth_token || !parsed.ct0) {
      message.error('Cookie 中需包含 auth_token 与 ct0');
      return;
    }
    setModalLoading(true);
    try {
      // 保留完整 Cookie（含 twid），不要只存两个字段
      const accountInfo = await getAccountInfo(nextCookie);
      setAccountInfo(accountInfo);
      setModalOpen(false);
      setCookieString(nextCookie);
      form.setFieldsValue({
        auth_token: parsed.auth_token,
        ct0: parsed.ct0,
      });
      setRawCookie('');
    } catch (err: any) {
      log.error(err);
      message.error(
        err?.message
          ? `无法登录：${err.message}`
          : '无法登录，请检查 Cookie 或代理配置是否正确',
      );
    } finally {
      setModalLoading(false);
    }
  };

  const onFormFinished = async (values: any) => {
    // 若粘贴了完整 Cookie，优先用完整串；否则用表单字段拼装
    if (rawCookie.trim()) {
      await applyCookieAndLogin(rawCookie.trim());
      return;
    }
    await applyCookieAndLogin(stringifyCookie(values));
  };

  const onModalOk = async () => {
    if (rawCookie.trim()) {
      await applyCookieAndLogin(rawCookie.trim());
      return;
    }
    form.submit();
  };

  const cookies = parseCookie(cookieString);

  return (
    <>
      <div className="px-4">
        <section
          aria-label="个人信息"
          className="flex flex-col justify-center items-center border-b-[1px] py-6 border-[rgba(255,255,255,0.5)]"
        >
          {!accountInfo && (
            <>
              <button
                disabled={loading}
                className={clsx(
                  'bg-transparent',
                  loading && 'hover:cursor-wait',
                )}
                onClick={() => setModalOpen(true)}
              >
                <Avatar size={50}>{loading ? '加载中' : '登录'}</Avatar>
              </button>
              <span className="sr-only" role="alert">
                账号未登录
              </span>
            </>
          )}
          {accountInfo && (
            <>
              <span className="sr-only" role="alert">
                账号 {accountInfo.screenName} 已登录
              </span>
              <a
                className="focus:outline !outline-4 !outline-black"
                title="前往个人主页"
                aria-label="前往个人主页"
                target="_blank"
                href={`https://twitter.com/${accountInfo.screenName}`}
                rel="noreferrer"
              >
                <CachedAvatar
                  size={50}
                  screenName={accountInfo.screenName}
                  src={accountInfo.avatar}
                  alt="头像"
                />
              </a>
              <div className="text-white mt-1 font-bold">
                {accountInfo.screenName}
              </div>
              <div>
                <button
                  onClick={() => {
                    setCookieString('');
                  }}
                  className="text-white bg-transparent hover:text-gray-200 transition-colors text-sm"
                >
                  <LogoutOutlined aria-hidden />
                  <span className="ml-1">登出</span>
                </button>
              </div>
            </>
          )}
        </section>
      </div>
      <Modal
        onOk={onModalOk}
        confirmLoading={modalLoading}
        onCancel={() => setModalOpen(false)}
        open={modalOpen}
        title="设置 Twitter 的 Cookie"
      >
        <div className="mt-2 mb-3">
          <div className="mb-1 text-sm text-gray-600">
            推荐：粘贴浏览器完整 Cookie（含 twid）
          </div>
          <Input.TextArea
            rows={4}
            value={rawCookie}
            onChange={(e) => setRawCookie(e.target.value)}
            placeholder="guest_id=...; auth_token=...; ct0=...; twid=u%3D..."
          />
        </div>
        <Form
          labelCol={{ span: 5 }}
          form={form}
          className="mt-2"
          onFinish={onFormFinished}
          initialValues={cookies}
        >
          <FormItem
            name="auth_token"
            label="auth_token"
            rules={[
              {
                type: 'string',
                required: !rawCookie.trim(),
              },
            ]}
          >
            <Input placeholder="名称为 auth_token 的值" />
          </FormItem>
          <FormItem
            name="ct0"
            label="ct0"
            rules={[
              {
                type: 'string',
                required: !rawCookie.trim(),
              },
            ]}
          >
            <Input placeholder="名称为 ct0 的值" />
          </FormItem>
        </Form>
        <p className="mt-2">
          <button
            onClick={() => {
              Modal.confirm({
                title: '寻找 Cookie 的方法',
                icon: null,
                content: (
                  <>
                    <p>1. 打开 x.com 并登录。</p>
                    <p>2. 按【F12】打开开发者工具。</p>
                    <p>3. 找到【应用程序（Applications）】选项卡。</p>
                    <p>4. 在左侧【Cookie】中选中【https://x.com】。</p>
                    <p>
                      5. 可复制完整 Cookie，或单独填写 auth_token、ct0（建议带上
                      twid）。
                    </p>
                  </>
                ),
              });
            }}
            className="text-ant-color-link flex items-center bg-transparent"
          >
            <QuestionCircleOutlined
              className="transform translate-y-[0.6px]"
              aria-hidden
            />
            <span className="ml-1">寻找 Cookie 的方法</span>
          </button>
        </p>
        {modalLoading && (
          <span className="sr-only" role="status">
            登录中，请稍候
          </span>
        )}
      </Modal>
    </>
  );
};
