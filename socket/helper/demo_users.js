//this id demo users use when we not implement API 
let users = [{
    "name": "abc",
    "user_name": "abc_12",
    "profile_pic": "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQ8czzbrLzXJ9R_uhKyMiwj1iGxKhJtH7pwlQ&usqp=CAU",
    "token": '1111',
    "userId": '12',
},
{
    "name": "abc12",
    "user_name": "abc_123",
    "profile_pic": "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQ8czzbrLzXJ9R_uhKyMiwj1iGxKhJtH7pwlQ&usqp=CAU",
    "token": '2222',
    "userId": '13',
},
{
    "name": "abc3",
    "user_name": "abc_1233",
    "profile_pic": "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQ8czzbrLzXJ9R_uhKyMiwj1iGxKhJtH7pwlQ&usqp=CAU",
    "token": '3333',
    "userId": "14",
},
{
    "name": "abc4",
    "user_name": "abc_12344",
    "profile_pic": "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQ8czzbrLzXJ9R_uhKyMiwj1iGxKhJtH7pwlQ&usqp=CAU",
    "token": '4444',
    "userId": "15",
}
]
const getUser = async (token) => {
    let us;
    users.map(userData => {
        if (userData.token == token) {
            us = userData
        }
    })
    return us
}
module.exports = { getUser }