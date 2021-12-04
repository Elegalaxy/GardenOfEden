using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class House : MonoBehaviour
{
    int recover = 30;
    public void sleep(Status stat) {
        //Test Code
        stat.set_stamina(100);
        //stat.change_stamina(recover);
    }
}
