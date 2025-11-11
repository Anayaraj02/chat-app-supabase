import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../supabaseClient";

export default function Dashboard() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [selectedUser, setSelectedUser] = useState(null);
  const [chats, setChats] = useState([]);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState("");
  const [onlineUsers, setOnlineUsers] = useState(new Set());
  const [unreadCounts, setUnreadCounts] = useState({}); // { senderId: count }
  const scrollRef = useRef(null);

  // ----- session -----
  useEffect(() => {
    const checkSession = async () => {
      const { data } = await supabase.auth.getSession();
      if (!data?.session) {
        navigate("/login");
        return;
      }
      // get user info
      const { data: userData } = await supabase.auth.getUser();
      setUser(userData.user);
    };
    checkSession();
  }, [navigate]);

  // ----- load profiles + initialize unread counts -----
  useEffect(() => {
    if (!user) return;

    const load = async () => {
      // 1) load user profiles (other users)
      const { data: profiles, error: pErr } = await supabase
        .from("profiles")
        .select("id, name, email, last_online");
      if (pErr) {
        console.error("profiles fetch:", pErr);
      } else {
        setChats((profiles || []).filter((p) => p.id !== user.id));
      }

      // 2) compute unread counts (messages where receiver = me and seen = false)
      const { data: unseen, error: uErr } = await supabase
        .from("messages")
        .select("sender_id")
        .eq("receiver_id", user.id)
        .eq("seen", false);
      if (uErr) {
        console.error("unseen fetch:", uErr);
      } else {
        // build map: sender_id -> count
        const counts = {};
        (unseen || []).forEach((m) => {
          counts[m.sender_id] = (counts[m.sender_id] || 0) + 1;
        });
        setUnreadCounts(counts);
      }
    };

    load();
  }, [user]);

  // ----- presence (instant online/offline) -----
  useEffect(() => {
    if (!user) return;

    const channel = supabase.channel("online-users", {
      config: { presence: { key: user.id } },
    });

    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState();
        const onlineIds = new Set(Object.keys(state));
        setOnlineUsers(onlineIds);
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track({ online_at: new Date().toISOString() });
        }
      });

    return () => {
      channel.untrack();
      supabase.removeChannel(channel);
    };
  }, [user]);

  // ----- load messages for selectedUser and mark seen -----
  useEffect(() => {
    if (!selectedUser || !user) {
      setMessages([]);
      return;
    }

    let mounted = true;
    const loadMessages = async () => {
      const { data, error } = await supabase
        .from("messages")
        .select("*")
        .or(
          `and(sender_id.eq.${user.id},receiver_id.eq.${selectedUser.id}),and(sender_id.eq.${selectedUser.id},receiver_id.eq.${user.id})`
        )
        .order("created_at", { ascending: true });

      if (error) {
        console.error("fetch messages:", error);
      } else if (mounted) {
        setMessages(data || []);
      }

      // mark unseen messages from selectedUser -> me as seen (DB)
      const { error: markErr } = await supabase
        .from("messages")
        .update({ seen: true, seen_at: new Date().toISOString() })
        .eq("sender_id", selectedUser.id)
        .eq("receiver_id", user.id)
        .eq("seen", false);
      if (markErr) console.error("mark seen error:", markErr);

      // clear unread count for this chat locally
      setUnreadCounts((prev) => ({ ...prev, [selectedUser.id]: 0 }));
    };

    loadMessages();
    return () => {
      mounted = false;
    };
  }, [selectedUser, user]);

  // ----- realtime messages (increment unreadCounts when not in open chat) -----
  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel("chat-realtime")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        async (payload) => {
          const msg = payload.new;
          if (!msg) return;

          // only care if the message involves current user
          if (msg.sender_id !== user.id && msg.receiver_id !== user.id) return;

          // if message is for the currently open chat, append and mark seen
          const isOpen =
            selectedUser &&
            ((msg.sender_id === selectedUser.id && msg.receiver_id === user.id) ||
              (msg.sender_id === user.id && msg.receiver_id === selectedUser.id));

          if (isOpen) {
            setMessages((prev) => {
              // dedupe by id if necessary
              if (prev.some((m) => m.id === msg.id)) return prev;
              return [...prev, msg];
            });

            // if incoming message from other user, mark seen
            if (msg.sender_id === selectedUser.id && !msg.seen) {
              await supabase
                .from("messages")
                .update({ seen: true, seen_at: new Date().toISOString() })
                .eq("id", msg.id);
            }
          } else {
            // message is for me but another chat (not open) => increment unread for sender
            if (msg.receiver_id === user.id) {
              setUnreadCounts((prev) => ({
                ...prev,
                [msg.sender_id]: (prev[msg.sender_id] || 0) + 1,
              }));
            }
          }

          // Move the chat with the new message (sender side) to top of chats list
          const partnerId = msg.sender_id === user.id ? msg.receiver_id : msg.sender_id;
          setChats((prev) => {
            const copy = [...prev];
            const idx = copy.findIndex((c) => c.id === partnerId);
            if (idx !== -1) {
              const chat = { ...copy[idx] };
              chat.last_message = msg.content;
              chat.last_message_time = msg.created_at;
              copy.splice(idx, 1);
              copy.unshift(chat);
              return copy;
            }
            return prev;
          });
        }
      )
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, [user, selectedUser]);

  // ----- scroll to bottom on messages change -----
  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ----- send message (do not locally increment other's unread; their realtime will handle) -----
  const sendMessage = async (e) => {
    e.preventDefault();
    if (!newMessage.trim() || !selectedUser || !user) return;

    const payload = {
      sender_id: user.id,
      receiver_id: selectedUser.id,
      content: newMessage.trim(),
      created_at: new Date().toISOString(),
      seen: false,
    };

    setNewMessage("");

    const { error } = await supabase.from("messages").insert(payload);
    if (error) console.error("send error:", error);
    // don't manually increment unread for recipient — their client realtime will manage it
  };

  // ----- on click chat => select and clear unread + mark seen on DB (safety) -----
  const openChat = async (chat) => {
    setSelectedUser(chat);
    // clear local unread immediately
    setUnreadCounts((prev) => ({ ...prev, [chat.id]: 0 }));

    // ensure DB messages are marked seen (safety, in case realtime missed)
    try {
      await supabase
        .from("messages")
        .update({ seen: true, seen_at: new Date().toISOString() })
        .eq("sender_id", chat.id)
        .eq("receiver_id", user.id)
        .eq("seen", false);
    } catch (e) {
      console.error("mark seen on open error:", e);
    }
  };

  // ----- get displayed unread for sidebar -----
  const displayedUnread = (chatId) => {
    // hide if this chat is currently open
    if (selectedUser?.id === chatId) return 0;
    return unreadCounts[chatId] || 0;
  };

  // ----- logout -----
  const handleLogout = async () => {
    if (user) {
      await supabase
        .from("profiles")
        .update({
          last_online: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
        })
        .eq("id", user.id);
    }
    await supabase.auth.signOut();
    navigate("/login");
  };

  return (
    <div className="flex h-screen bg-gray-50 flex-col md:flex-row">
      {/* Sidebar */}
      <div className="w-full md:w-[30%] bg-indigo-50 border-r border-indigo-100 flex flex-col">
        <div className="p-4 flex items-center justify-between border-b">
          <span className="font-semibold text-indigo-700">{user?.email}</span>
          <button
            onClick={handleLogout}
            className="text-sm text-red-500 hover:text-red-700"
          >
            Logout
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {chats.map((chat) => {
            const isOnline = onlineUsers.has(chat.id);
            const unread = displayedUnread(chat.id);
            return (
              <div
                key={chat.id}
                onClick={() => openChat(chat)}
                className={`flex items-center justify-between p-2 rounded-lg cursor-pointer hover:bg-indigo-100 ${
                  selectedUser?.id === chat.id ? "bg-indigo-100" : ""
                }`}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`w-3 h-3 rounded-full ${
                      isOnline ? "bg-green-400" : "bg-gray-400"
                    }`}
                  ></div>
                  <div>
                    <div className="font-medium">{chat.name || chat.email}</div>
                    <div className="text-xs text-gray-500">
                      {isOnline ? "Online" : "Offline"}
                    </div>
                  </div>
                </div>
                {unread > 0 && (
                  <span className="bg-indigo-600 text-white text-xs px-2 py-1 rounded-full">
                    {unread}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Chat Area */}
      <div className="w-full md:w-[70%] flex flex-col">
        {!selectedUser ? (
          <div className="flex-1 flex items-center justify-center text-gray-400">
            👋 Welcome! Select a user to start chatting.
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3 p-4 border-b border-gray-200">
              <div className="rounded-full bg-gray-300 w-10 h-10"></div>
              <div>
                <span className="font-semibold">
                  {selectedUser.name || selectedUser.email}
                </span>
                <div className="text-xs text-gray-400">
                  {onlineUsers.has(selectedUser.id) ? "Online" : "Offline"}
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-indigo-50">
              {messages.length === 0 && (
                <div className="text-center text-gray-400 mt-10">
                  👋 Say hi to start your conversation!
                </div>
              )}

              {messages.map((m) => (
                <div
                  key={m.id}
                  className={`flex flex-col max-w-[70%] ${
                    m.sender_id === user.id ? "ml-auto items-end" : "mr-auto items-start"
                  }`}
                >
                  <div
                    className={`px-4 py-2 rounded-2xl ${
                      m.sender_id === user.id ? "bg-indigo-600 text-white" : "bg-white text-gray-800"
                    }`}
                  >
                    {m.content}
                  </div>
                  <span className="text-xs text-gray-400 mt-1">
                    {new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    {m.sender_id === user.id && (
                      <span className="ml-2 text-xs">{m.seen ? "✅✅" : "✅"}</span>
                    )}
                  </span>
                </div>
              ))}
              <div ref={scrollRef}></div>
            </div>

            <form onSubmit={sendMessage} className="flex p-4 gap-2 border-t border-gray-200">
              <input
                type="text"
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                placeholder="Type message..."
                className="flex-1 border rounded-full px-4 py-2 focus:ring-2 focus:ring-indigo-300 outline-none"
              />
              <button type="submit" className="bg-indigo-600 text-white px-5 py-2 rounded-full">
                Send
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
